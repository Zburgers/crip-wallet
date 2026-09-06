pragma solidity 0.8.30;

import {MockERC20} from "../src/MockERC20.sol";

interface Vm {
    function parseUint(string calldata value) external pure returns (uint256 result);
    function readFile(string calldata path) external returns (string memory contents);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployMockERC20 {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    string private constant DEPLOYER_KEY_FILE = "/tmp/crip-wallet-deployer.key";

    function run() external returns (MockERC20 token) {
        uint256 deployerKey = vm.parseUint(vm.readFile(DEPLOYER_KEY_FILE));
        vm.startBroadcast(deployerKey);
        token = new MockERC20();
        vm.stopBroadcast();
    }
}
