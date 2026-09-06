pragma solidity 0.8.30;

/// @notice Minimal fixed-supply ERC-20 fixture for the local Anvil environment.
contract MockERC20 {
    string public constant name = "Crip Test USD";
    string public constant symbol = "TEST_USDC";
    uint8 public constant decimals = 6;
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10 ** 6;

    // Deliberate fault-injection seam; this address is never a valid fixture recipient.
    address public constant REVERT_RECIPIENT = 0x000000000000000000000000000000000000dEaD;

    uint256 public totalSupply;
    mapping(address account => uint256) public balanceOf;

    error ZeroAddress();
    error InsufficientBalance();
    error DeterministicRevert();

    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor() {
        totalSupply = INITIAL_SUPPLY;
        balanceOf[msg.sender] = INITIAL_SUPPLY;
        emit Transfer(address(0), msg.sender, INITIAL_SUPPLY);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        if (to == REVERT_RECIPIENT) revert DeterministicRevert();

        uint256 senderBalance = balanceOf[msg.sender];
        if (senderBalance < amount) revert InsufficientBalance();

        balanceOf[msg.sender] = senderBalance - amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}
