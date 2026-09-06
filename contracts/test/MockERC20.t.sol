pragma solidity 0.8.30;

import {MockERC20} from "../src/MockERC20.sol";

interface Vm {
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
    function expectRevert(bytes4 revertData) external;
}

contract MockERC20Test {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event Transfer(address indexed from, address indexed to, uint256 value);

    uint256 private constant EXPECTED_SUPPLY = 1_000_000 * 10 ** 6;
    address private constant RECIPIENT = address(0xBEEF);

    MockERC20 private token;

    function setUp() public {
        token = new MockERC20();
    }

    function testMetadata() public view {
        require(keccak256(bytes(token.name())) == keccak256(bytes("Crip Test USD")), "name");
        require(keccak256(bytes(token.symbol())) == keccak256(bytes("TEST_USDC")), "symbol");
    }

    function testDecimalsAreSix() public view {
        require(token.decimals() == 6, "decimals");
    }

    function testDeterministicInitialSupply() public view {
        require(token.totalSupply() == EXPECTED_SUPPLY, "supply");
    }

    function testInitialSupplyAssignedToDeployer() public view {
        require(token.balanceOf(address(this)) == EXPECTED_SUPPLY, "deployer balance");
    }

    function testTransferSucceedsAndUpdatesBalances() public {
        uint256 amount = 250_000;

        bool success = token.transfer(RECIPIENT, amount);

        require(success, "transfer result");
        require(token.balanceOf(address(this)) == EXPECTED_SUPPLY - amount, "sender balance");
        require(token.balanceOf(RECIPIENT) == amount, "recipient balance");
    }

    function testTransferEmitsStandardEvent() public {
        uint256 amount = 250_000;

        vm.expectEmit(true, true, false, true, address(token));
        emit Transfer(address(this), RECIPIENT, amount);
        token.transfer(RECIPIENT, amount);
    }

    function testInsufficientBalanceReverts() public {
        vm.expectRevert(MockERC20.InsufficientBalance.selector);
        token.transfer(RECIPIENT, EXPECTED_SUPPLY + 1);
    }

    function testZeroAddressTransferReverts() public {
        vm.expectRevert(MockERC20.ZeroAddress.selector);
        token.transfer(address(0), 1);
    }

    function testDeterministicRevertRecipientReverts() public {
        address revertRecipient = token.REVERT_RECIPIENT();
        vm.expectRevert(MockERC20.DeterministicRevert.selector);
        token.transfer(revertRecipient, 1);
    }

    function testNoPostDeployMintAuthorityExists() public {
        (bool mintSucceeded,) = address(token).call(
            abi.encodeWithSignature("mint(address,uint256)", address(this), 1)
        );

        require(!mintSucceeded, "mint authority");
        require(token.totalSupply() == EXPECTED_SUPPLY, "supply changed");
    }
}
