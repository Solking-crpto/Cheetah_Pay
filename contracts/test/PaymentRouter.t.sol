// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {PaymentRouter} from "../PaymentRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ─── Minimal mock ERC-20 ──────────────────────────────────────────────────────

/**
 * @dev Minimal ERC-20 mock used to simulate Arc USDC in a local test fork.
 *      The real Arc USDC address (0x3600...0000) is deployed only on live Arc
 *      networks.  In Foundry's local anvil environment the address has no code,
 *      so we `vm.etch` our mock bytecode there.
 */
contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    string public name     = "USD Coin";
    string public symbol   = "USDC";
    uint8  public decimals = 6;

    event Transfer(address indexed from, address indexed to,    uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from]              >= amount, "insufficient balance");
        require(allowance[from][msg.sender]  >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

// ─── Reentrancy attacker ──────────────────────────────────────────────────────

/**
 * @dev Attempts reentrancy during a `pay` call by re-entering `pay` inside a
 *      mock transferFrom hook.  The nonReentrant guard must block the inner call.
 */
contract ReentrancyMockUSDC {
    PaymentRouter private target;
    address       private merchant;
    bool          private attacking;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint8  public decimals = 6;
    string public name     = "ReentrancyUSDC";
    string public symbol   = "rUSDC";

    function setTarget(PaymentRouter _target, address _merchant) external {
        target   = _target;
        merchant = _merchant;
    }

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        return true;
    }

    /// @dev On the first call attempt re-entry.  nonReentrant must block it.
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from]             >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        if (!attacking) {
            attacking = true;
            try target.pay(bytes32("reentrant"), address(this), merchant, amount) {} catch {}
            attacking = false;
        }
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        return true;
    }
}

// ─── Test contract ────────────────────────────────────────────────────────────

/**
 * @title  PaymentRouterTest
 * @notice Foundry unit + fuzz tests covering the pay-only PaymentRouter.
 *
 * Test cases:
 *   1.  Successful payment and correct direct transfer
 *   2.  Correct Paid event emission
 *   3.  Duplicate payment ID
 *   4.  Zero amount and invalid addresses
 *   5.  Unsupported or incorrect token
 *   6.  Payment without sufficient allowance or balance
 *   7.  Paused payment operations
 *   8.  Reentrancy resistance
 *   9.  Isolation between separate payment IDs
 *  10.  Payment record fields are correct
 *  F1.  Fuzz: pay amount is correctly recorded
 */
contract PaymentRouterTest is Test {

    // ── Constants ─────────────────────────────────────────────────────────────

    address constant USDC_ADDR  = 0x3600000000000000000000000000000000000000;
    address constant FAKE_TOKEN = address(0xdEaD);
    uint256 constant ONE_USDC   = 1e6;

    // ── Actors ────────────────────────────────────────────────────────────────

    address owner    = makeAddr("owner");
    address payer    = makeAddr("payer");
    address merchant = makeAddr("merchant");
    address attacker = makeAddr("attacker");
    address stranger = makeAddr("stranger");

    // ── State ─────────────────────────────────────────────────────────────────

    PaymentRouter router;
    MockUSDC      usdc;

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        usdc = new MockUSDC();
        vm.etch(USDC_ADDR, address(usdc).code);
        usdc = MockUSDC(USDC_ADDR);

        vm.prank(owner);
        router = new PaymentRouter(owner);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _fund(address account, uint256 amount) internal {
        usdc.mint(account, amount);
        vm.prank(account);
        usdc.approve(address(router), amount);
    }

    function _pay(bytes32 id, address _payer, address _merchant, uint256 amount) internal {
        _fund(_payer, amount);
        vm.prank(_payer);
        router.pay(id, USDC_ADDR, _merchant, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 1: Successful payment and correct direct transfer
    // ─────────────────────────────────────────────────────────────────────────

    function test_payment_transfersDirectlyToMerchant() public {
        uint256 amount = 100 * ONE_USDC;
        bytes32 id     = keccak256("pay-001");

        uint256 merchantBefore = usdc.balanceOf(merchant);
        _fund(payer, amount);

        vm.prank(payer);
        router.pay(id, USDC_ADDR, merchant, amount);

        assertEq(usdc.balanceOf(merchant),        merchantBefore + amount, "merchant received");
        assertEq(usdc.balanceOf(payer),            0,                       "payer balance consumed");
        assertEq(usdc.balanceOf(address(router)),  0,                       "router holds nothing");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 2: Correct Paid event emission
    // ─────────────────────────────────────────────────────────────────────────

    function test_payment_emitsPaidEvent() public {
        uint256 amount = 50 * ONE_USDC;
        bytes32 id     = keccak256("pay-002");
        _fund(payer, amount);

        vm.expectEmit(true, true, true, true);
        emit PaymentRouter.Paid(id, payer, merchant, USDC_ADDR, amount);

        vm.prank(payer);
        router.pay(id, USDC_ADDR, merchant, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 3: Duplicate payment ID
    // ─────────────────────────────────────────────────────────────────────────

    function test_revert_duplicatePaymentId() public {
        bytes32 id = keccak256("pay-003");
        _pay(id, payer, merchant, 10 * ONE_USDC);

        _fund(payer, 10 * ONE_USDC);
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(PaymentRouter.DuplicatePaymentId.selector, id)
        );
        router.pay(id, USDC_ADDR, merchant, 10 * ONE_USDC);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 4: Zero amount and invalid addresses
    // ─────────────────────────────────────────────────────────────────────────

    function test_revert_zeroAmount() public {
        _fund(payer, ONE_USDC);
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.ZeroAmount.selector);
        router.pay(keccak256("pay-004a"), USDC_ADDR, merchant, 0);
    }

    function test_revert_zeroMerchantAddress() public {
        _fund(payer, ONE_USDC);
        vm.prank(payer);
        vm.expectRevert(PaymentRouter.ZeroAddress.selector);
        router.pay(keccak256("pay-004b"), USDC_ADDR, address(0), ONE_USDC);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 5: Unsupported or incorrect token
    // ─────────────────────────────────────────────────────────────────────────

    function test_revert_unsupportedToken() public {
        _fund(payer, ONE_USDC);
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(PaymentRouter.UnsupportedToken.selector, FAKE_TOKEN)
        );
        router.pay(keccak256("pay-005"), FAKE_TOKEN, merchant, ONE_USDC);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 6: Payment without sufficient allowance or balance
    // ─────────────────────────────────────────────────────────────────────────

    function test_revert_insufficientAllowance() public {
        usdc.mint(payer, 100 * ONE_USDC); // balance but no approval
        vm.prank(payer);
        vm.expectRevert();
        router.pay(keccak256("pay-006a"), USDC_ADDR, merchant, 100 * ONE_USDC);
    }

    function test_revert_insufficientBalance() public {
        vm.prank(payer);
        usdc.approve(address(router), 100 * ONE_USDC); // approval but no balance
        vm.prank(payer);
        vm.expectRevert();
        router.pay(keccak256("pay-006b"), USDC_ADDR, merchant, 100 * ONE_USDC);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 7: Paused payment operations
    // ─────────────────────────────────────────────────────────────────────────

    function test_revert_payWhilePaused() public {
        vm.prank(owner);
        router.pause();

        _fund(payer, 10 * ONE_USDC);
        vm.prank(payer);
        vm.expectRevert(); // Pausable.EnforcedPause
        router.pay(keccak256("pay-007a"), USDC_ADDR, merchant, 10 * ONE_USDC);
    }

    function test_resumeAfterUnpause() public {
        vm.prank(owner);
        router.pause();
        vm.prank(owner);
        router.unpause();

        bytes32 id = keccak256("pay-007b");
        _pay(id, payer, merchant, 5 * ONE_USDC);

        assertEq(
            uint256(router.getPayment(id).status),
            uint256(PaymentRouter.PaymentStatus.Paid),
            "payment recorded post-unpause"
        );
    }

    function test_revert_nonOwnerCannotPause() public {
        vm.prank(attacker);
        vm.expectRevert(); // Ownable.OwnableUnauthorizedAccount
        router.pause();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 8: Reentrancy resistance
    // ─────────────────────────────────────────────────────────────────────────

    function test_reentrancyGuard_blocksDuringPay() public {
        ReentrancyMockUSDC reentrantUSDC = new ReentrancyMockUSDC();
        vm.etch(USDC_ADDR, address(reentrantUSDC).code);
        ReentrancyMockUSDC rUSDC = ReentrancyMockUSDC(USDC_ADDR);

        vm.prank(owner);
        PaymentRouter reentrantRouter = new PaymentRouter(owner);

        rUSDC.setTarget(reentrantRouter, merchant);
        rUSDC.mint(payer, 100 * ONE_USDC);

        vm.prank(payer);
        rUSDC.approve(address(reentrantRouter), 100 * ONE_USDC);

        bytes32 id = keccak256("pay-008");

        vm.prank(payer);
        reentrantRouter.pay(id, USDC_ADDR, merchant, 10 * ONE_USDC);

        // The re-entrant call used id "reentrant" — must NOT have been recorded.
        assertEq(
            uint256(reentrantRouter.getPayment(bytes32("reentrant")).status),
            uint256(PaymentRouter.PaymentStatus.NonExistent),
            "re-entrant payment must not be recorded"
        );

        vm.etch(USDC_ADDR, address(new MockUSDC()).code);
        usdc = MockUSDC(USDC_ADDR);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 9: Isolation between separate payment IDs
    // ─────────────────────────────────────────────────────────────────────────

    function test_isolation_separatePaymentIds() public {
        bytes32 idA = keccak256("pay-009A");
        bytes32 idB = keccak256("pay-009B");

        address merchantA = makeAddr("merchantA");
        address merchantB = makeAddr("merchantB");
        address payerA    = makeAddr("payerA");
        address payerB    = makeAddr("payerB");

        uint256 amountA = 70 * ONE_USDC;
        uint256 amountB = 30 * ONE_USDC;

        _pay(idA, payerA, merchantA, amountA);
        _pay(idB, payerB, merchantB, amountB);

        PaymentRouter.Payment memory pmtA = router.getPayment(idA);
        PaymentRouter.Payment memory pmtB = router.getPayment(idB);

        assertEq(pmtA.payer,    payerA,    "payerA");
        assertEq(pmtA.merchant, merchantA, "merchantA");
        assertEq(pmtA.amount,   amountA,   "amountA");

        assertEq(pmtB.payer,    payerB,    "payerB");
        assertEq(pmtB.merchant, merchantB, "merchantB");
        assertEq(pmtB.amount,   amountB,   "amountB");

        // Paying idA does not affect idB's record.
        assertEq(
            uint256(pmtB.status),
            uint256(PaymentRouter.PaymentStatus.Paid),
            "idB unaffected"
        );

        // Stranger cannot re-use idA.
        _fund(stranger, amountA);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(PaymentRouter.DuplicatePaymentId.selector, idA)
        );
        router.pay(idA, USDC_ADDR, merchantA, amountA);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Test 10: Payment record fields are correct
    // ─────────────────────────────────────────────────────────────────────────

    function test_paymentRecord_fieldsAreCorrect() public {
        bytes32 id     = keccak256("pay-010");
        uint256 amount = 77 * ONE_USDC;
        _pay(id, payer, merchant, amount);

        PaymentRouter.Payment memory pmt = router.getPayment(id);
        assertEq(pmt.paymentId, id,       "paymentId");
        assertEq(pmt.payer,     payer,    "payer");
        assertEq(pmt.merchant,  merchant, "merchant");
        assertEq(pmt.amount,    amount,   "amount");
        assertEq(
            uint256(pmt.status),
            uint256(PaymentRouter.PaymentStatus.Paid),
            "status Paid"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fuzz F1: pay amount is correctly recorded
    // ─────────────────────────────────────────────────────────────────────────

    function testFuzz_payment_amountRecorded(uint256 amount) public {
        vm.assume(amount > 0 && amount < type(uint128).max);
        bytes32 id = keccak256(abi.encode(amount, block.timestamp));
        _fund(payer, amount);
        vm.prank(payer);
        router.pay(id, USDC_ADDR, merchant, amount);
        assertEq(router.getPayment(id).amount, amount, "fuzz amount recorded");
    }
}
