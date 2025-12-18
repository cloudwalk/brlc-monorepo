// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { CashbackController } from "../CashbackController.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

/**
 * @title CashbackControllerWithForcibleRole test contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Test helper that exposes role force-grant and initializes parent contracts.
 * @custom:oz-upgrades-unsafe-allow missing-initializer
 */
contract CashbackControllerWithForcibleRole is CashbackController {
    function forceHookTriggerRole(address account) public {
        AccessControlUpgradeable._grantRole(HOOK_TRIGGER_ROLE, account);
    }
}
