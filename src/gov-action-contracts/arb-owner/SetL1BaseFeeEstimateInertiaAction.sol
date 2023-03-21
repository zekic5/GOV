// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.16;

import "./ArbOwnerLib.sol";

contract SetL1BaseFeeEstimateInertiaAction {
    function perform(uint64 newInertia) external {
        ArbOwnerLib.arbOwner.setL1BaseFeeEstimateInertia(newInertia);
    }
}
