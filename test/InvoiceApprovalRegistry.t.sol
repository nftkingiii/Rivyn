// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { InvoiceApprovalRegistry } from "../contracts/InvoiceApprovalRegistry.sol";

contract ApprovalActor {
    function approve(InvoiceApprovalRegistry registry, bytes32 invoiceId, address payee, uint256 amount) external {
        registry.approveInvoice(invoiceId, payee, amount);
    }
}

contract InvoiceApprovalRegistryTest {
    InvoiceApprovalRegistry internal registry;
    ApprovalActor internal buyer;
    ApprovalActor internal secondBuyer;

    function setUp() public {
        registry = new InvoiceApprovalRegistry();
        buyer = new ApprovalActor();
        secondBuyer = new ApprovalActor();
    }

    function testBuyerApprovalIsRecordedOnce() public {
        bytes32 invoiceId = keccak256("invoice-1");
        buyer.approve(registry, invoiceId, address(0xBEEF), 3 ether);
        bytes32 approvalKey = keccak256(abi.encode(invoiceId, address(buyer)));
        require(registry.approvals(approvalKey), "approval missing");

        (bool success,) =
            address(buyer).call(abi.encodeCall(ApprovalActor.approve, (registry, invoiceId, address(0xBEEF), 3 ether)));
        require(!success, "duplicate approval accepted");
    }

    function testSameInvoiceIdDoesNotLetAnotherBuyerBlockTheRealBuyer() public {
        bytes32 invoiceId = keccak256("shared-id");
        secondBuyer.approve(registry, invoiceId, address(0xCAFE), 1 ether);
        buyer.approve(registry, invoiceId, address(0xCAFE), 1 ether);

        require(registry.approvals(keccak256(abi.encode(invoiceId, address(secondBuyer)))), "second buyer missing");
        require(registry.approvals(keccak256(abi.encode(invoiceId, address(buyer)))), "buyer missing");
    }

    function testRejectsZeroInvoiceZeroPayeeAndZeroAmount() public {
        (bool zeroId,) =
            address(buyer).call(abi.encodeCall(ApprovalActor.approve, (registry, bytes32(0), address(0xBEEF), 1)));
        (bool zeroPayee,) =
            address(buyer).call(abi.encodeCall(ApprovalActor.approve, (registry, keccak256("a"), address(0), 1)));
        (bool zeroAmount,) =
            address(buyer).call(abi.encodeCall(ApprovalActor.approve, (registry, keccak256("b"), address(0xBEEF), 0)));
        require(!zeroId && !zeroPayee && !zeroAmount, "invalid approval accepted");
    }
}
