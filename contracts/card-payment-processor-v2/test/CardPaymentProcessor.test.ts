import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionReceipt, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  checkContractUupsUpgrading,
  connect,
  getAddress,
  getTxTimestamp,
  increaseBlockTimestamp,
  proveTx,
} from "../test-utils/eth";
import {
  checkEquality,
  checkEventParameter,
  checkEventParameterNotEqual,
  EventParameterCheckingOptions,
} from "../test-utils/checkers";
import { setUpFixture } from "../test-utils/common";
import * as Contracts from "../typechain-types";

const MAX_UINT256 = ethers.MaxUint256;
const MAX_INT256 = ethers.MaxInt256;
const MAX_UINT64 = BigInt("0xffffffffffffffff");
const ZERO_ADDRESS = ethers.ZeroAddress;
const ZERO_CONFIRMATION_AMOUNT = 0;
const ZERO_PAYER_ADDRESS = ethers.ZeroAddress;
const ZERO_REFUND_AMOUNT = 0;
const ZERO_SPONSOR_ADDRESS = ethers.ZeroAddress;
const ZERO_SUBSIDY_LIMIT = 0;
const CASHBACK_RATE_AS_IN_CONTRACT = -1;
const TOKEN_DECIMALS = 6;
const CASHBACK_ROUNDING_COEF = 10 ** (TOKEN_DECIMALS - 2);
const DIGITS_COEF = 10 ** TOKEN_DECIMALS;
const INITIAL_USER_BALANCE = 1000_000 * DIGITS_COEF;
const INITIAL_SPONSOR_BALANCE = INITIAL_USER_BALANCE * 2;
const CASHBACK_FACTOR = 1000;
const CASHBACK_CAP_RESET_PERIOD = 30 * 24 * 60 * 60;
const MAX_CASHBACK_FOR_CAP_PERIOD = 300 * 10 ** TOKEN_DECIMALS;

const EVENT_ADDENDUM_VERSION_DEFAULT_VALUE = "01";
const EVENT_ADDENDUM_FLAGS_NON_SUBSIDIZED = "00";
const EVENT_ADDENDUM_FLAGS_SUBSIDIZED = "01";
const EVENT_ADDENDUM_CHARS_FOR_AMOUNT = 16;

const eventAddendumCheckingOptions: EventParameterCheckingOptions = {
  showValuesInErrorMessage: true,
  caseInsensitiveComparison: true,
};

// Events of the contracts under test
const EVENT_NAME_ACCOUNT_REFUNDED = "AccountRefunded";
const EVENT_NAME_CASH_OUT_ACCOUNT_CHANGED = "CashOutAccountChanged";
const EVENT_NAME_CASHBACK_SENT = "CashbackSent";
const EVENT_NAME_CASHBACK_INCREASED = "CashbackIncreased";
const EVENT_NAME_CASHBACK_DECREASED = "CashbackDecreased";
const EVENT_NAME_DEFAULT_CASHBACK_RATE_CHANGED = "DefaultCashbackRateChanged";
const EVENT_NAME_PAYMENT_CONFIRMED_AMOUNT_CHANGED = "PaymentConfirmedAmountChanged";
const EVENT_NAME_PAYMENT_MADE = "PaymentMade";
const EVENT_NAME_PAYMENT_REFUNDED = "PaymentRefunded";
const EVENT_NAME_PAYMENT_REVERSED = "PaymentReversed";
const EVENT_NAME_PAYMENT_REVOKED = "PaymentRevoked";
const EVENT_NAME_PAYMENT_UPDATED = "PaymentUpdated";

enum PaymentStatus {
  // Nonexistent = 0, is not used in the tests.
  Active = 1,
  Revoked = 2,
  Reversed = 3,
}

enum CashbackOperationStatus {
  Undefined = 0,
  Success = 1,
  Partial = 2,
  Capped = 3,
  OutOfFunds = 4,
}

interface PaymentConfirmation {
  paymentId: string;
  amount: number;
}

interface TestPayment {
  id: string;
  payer: HardhatEthersSigner;
  baseAmount: number;
  extraAmount: number;
}

interface PaymentModel {
  paymentId: string; // Does not exist in the contract
  status: PaymentStatus;
  payer: HardhatEthersSigner;
  cashbackEnabled: boolean;
  cashbackRate: number;
  confirmedAmount: number;
  sponsor?: HardhatEthersSigner;
  subsidyLimit: number;
  baseAmount: number;
  extraAmount: number;
  cashbackAmount: number;
  refundAmount: number;
}

interface AccountCashbackState {
  totalAmount: bigint;
  capPeriodStartAmount: bigint;
  capPeriodStartTime: number;
}

enum CashbackOperationKind {
  Undefined = 0,
  None = 1,
  Sending = 2,
  Increase = 3,
  Revocation = 4,
}

enum OperationKind {
  Undefined = 0,
  Making = 1,
  Updating = 2,
  Revoking = 3,
  Reversing = 4,
  Confirming = 5,
  Refunding = 6,
}

enum UpdatingOperationKind {
  Full = 0,
  Lazy = 1,
}

interface PaymentOperation {
  kind: OperationKind;
  paymentId: string;
  paymentStatus: PaymentStatus;
  sender?: HardhatEthersSigner;
  payer: HardhatEthersSigner;
  oldBaseAmount: number;
  newBaseAmount: number;
  oldExtraAmount: number;
  newExtraAmount: number;
  oldConfirmationAmount: number;
  newConfirmationAmount: number;
  oldRefundAmount: number;
  newRefundAmount: number;
  oldRemainder: number;
  newRemainder: number;
  oldCashbackAmount: number;
  oldPayerSumAmount: number;
  newPayerSumAmount: number;
  oldPayerRefundAmount: number;
  newPayerRefundAmount: number;
  oldPayerRemainder: number;
  newPayerRemainder: number;
  cashbackEnabled: boolean;
  cashbackOperationKind: CashbackOperationKind;
  cashbackOperationStatus: CashbackOperationStatus;
  cashbackRequestedChange: number; // From the user point of view, if "+" then the user earns cashback
  cashbackActualChange: number; // From the user point of view, if "+" then the user earns cashback
  cashbackRate: number;
  sponsor?: HardhatEthersSigner;
  subsidyLimit: number;
  oldSponsorSumAmount: number;
  newSponsorSumAmount: number;
  oldSponsorRefundAmount: number;
  newSponsorRefundAmount: number;
  oldSponsorRemainder: number;
  newSponsorRemainder: number;
  senderBalanceChange: number;
  cardPaymentProcessorBalanceChange: number;
  cashOutAccountBalanceChange: number;
  payerBalanceChange: number;
  sponsorBalanceChange: number;
  updatingOperationKind: UpdatingOperationKind;
  relatedPaymentIds: string[];
}

interface Fixture {
  cardPaymentProcessor: Contract;
  tokenMock: Contract;
  cashbackController: Contract;
}

interface AmountParts {
  payerBaseAmount: number;
  payerExtraAmount: number;
  payerSumAmount: number;
  sponsorBaseAmount: number;
  sponsorExtraAmount: number;
  sponsorSumAmount: number;
}

interface RefundParts {
  payerRefundAmount: number;
  sponsorRefundAmount: number;
}

enum CashbackConditionType {
  CashbackEnabled,
  CashbackDisabledBeforePaymentMaking,
  CashbackDisabledAfterPaymentMaking,
  CashbackEnabledButTreasuryHasInsufficientBalance,
  CashbackEnabledButIncreasingReverts,
  CashbackEnabledButIncreasingPartial,
}

class CardPaymentProcessorModel {
  #cashbackEnabled: boolean;
  readonly #cashbackRate: number;
  #paymentPerId: Map<string, PaymentModel> = new Map<string, PaymentModel>();
  #totalBalance = 0;
  #totalConfirmedAmount = 0;
  #totalUnconfirmedRemainder = 0;
  #paymentMakingOperations: PaymentOperation[] = [];
  #paymentOperations: PaymentOperation[] = [];
  #cashbackIncreaseStatus: CashbackOperationStatus = CashbackOperationStatus.Success;
  #cashbackIncreaseAmountResult = -1; // As expected by default cashback calculation
  #cashbackRevocationStatus: CashbackOperationStatus = CashbackOperationStatus.Success;
  #cashbackSendingStatus: CashbackOperationStatus = CashbackOperationStatus.Success;
  #cashbackSendingAmountResult = -1; // As expected by default cashback calculation
  #cashbackTotalPerAccount: Map<string, number> = new Map<string, number>();
  #capPeriodStartAmount = 0;

  constructor(props: {
    cashbackRate: number;
    cashbackEnabled: boolean;
  }) {
    this.#cashbackRate = props.cashbackRate;
    this.#cashbackEnabled = props.cashbackEnabled;
  }

  makePayment(
    payment: TestPayment,
    props: {
      sponsor?: HardhatEthersSigner;
      subsidyLimit?: number;
      cashbackRate?: number;
      confirmationAmount?: number;
      sender?: HardhatEthersSigner;
    } = {},
  ): number {
    const paymentModel: PaymentModel = this.#createPayment(payment);
    const operation: PaymentOperation = this.#createPaymentOperation(paymentModel, OperationKind.Making);
    operation.sender = props.sender ?? payment.payer;
    operation.oldBaseAmount = 0;
    operation.oldExtraAmount = 0;
    operation.oldRemainder = 0;
    operation.sponsor = props.sponsor;
    operation.subsidyLimit = !operation.sponsor ? 0 : (props.subsidyLimit ?? 0);
    operation.cashbackOperationKind = CashbackOperationKind.Sending;
    operation.newConfirmationAmount = props.confirmationAmount ?? 0;
    if (!!props.cashbackRate && props.cashbackRate > 0) {
      operation.cashbackRate = props.cashbackRate ?? 0;
    } else if (props.cashbackRate === 0) {
      operation.cashbackEnabled = false;
      operation.cashbackRate = 0;
    }
    this.#checkPaymentConfirming(operation);
    this.#definePaymentOperation(operation);
    return this.#registerPaymentMakingOperation(operation, paymentModel);
  }

  updatePayment(
    paymentId: string,
    newBaseAmount: number,
    newExtraAmount: number,
    updatingOperationKind: UpdatingOperationKind = UpdatingOperationKind.Full,
  ): number {
    const payment: PaymentModel = this.getPaymentById(paymentId);
    const operation: PaymentOperation = this.#createPaymentOperation(payment, OperationKind.Updating);
    operation.newBaseAmount = newBaseAmount;
    operation.newExtraAmount = newExtraAmount;
    operation.updatingOperationKind = updatingOperationKind;
    this.#checkPaymentUpdating(operation);
    this.#definePaymentOperation(operation);
    return this.#registerPaymentOperation(operation, payment);
  }

  revokePayment(paymentId: string): number {
    const payment: PaymentModel = this.getPaymentById(paymentId);
    const operation: PaymentOperation = this.#createPaymentOperation(payment, OperationKind.Revoking);
    operation.newBaseAmount = 0;
    operation.newExtraAmount = 0;
    operation.newConfirmationAmount = 0;
    operation.newRefundAmount = 0;
    this.#checkPaymentCanceling(operation);
    this.#definePaymentOperation(operation);
    this.#updateModelDueToPaymentCancelingOperation(operation);
    return this.#registerPaymentCancelingOperation(operation, payment, PaymentStatus.Revoked);
  }

  reversePayment(paymentId: string): number {
    const payment: PaymentModel = this.getPaymentById(paymentId);
    const operation: PaymentOperation = this.#createPaymentOperation(payment, OperationKind.Reversing);
    operation.newBaseAmount = 0;
    operation.newExtraAmount = 0;
    operation.newConfirmationAmount = 0;
    operation.newRefundAmount = 0;
    this.#checkPaymentCanceling(operation);
    this.#definePaymentOperation(operation);
    this.#updateModelDueToPaymentCancelingOperation(operation);
    return this.#registerPaymentCancelingOperation(operation, payment, PaymentStatus.Reversed);
  }

  confirmPayment(paymentId: string, confirmationAmount: number): number {
    const payment: PaymentModel = this.getPaymentById(paymentId);
    const operation: PaymentOperation = this.#createPaymentOperation(payment, OperationKind.Confirming);
    operation.cardPaymentProcessorBalanceChange = -confirmationAmount;
    operation.cashOutAccountBalanceChange = confirmationAmount;
    operation.newConfirmationAmount = operation.oldConfirmationAmount + confirmationAmount;
    this.#checkPaymentConfirming(operation);
    return this.#registerPaymentOperation(operation, payment);
  }

  refundPayment(
    paymentId: string,
    refundingAmount: number,
  ): number {
    const payment: PaymentModel = this.getPaymentById(paymentId);
    const operation: PaymentOperation = this.#createPaymentOperation(payment, OperationKind.Refunding);
    operation.newRefundAmount = operation.oldRefundAmount + refundingAmount;
    this.#checkPaymentRefunding(operation);
    this.#definePaymentOperation(operation);
    return this.#registerPaymentOperation(operation, payment);
  }

  disableCashback() {
    this.#cashbackEnabled = false;
  }

  getPaymentModelsInMakingOrder(): PaymentModel[] {
    const paymentNumber = this.#paymentMakingOperations.length;
    const paymentModels: PaymentModel[] = [];
    for (let i = 0; i < paymentNumber; ++i) {
      const paymentModel: PaymentModel = this.#getPaymentByMakingOperationIndex(i);
      paymentModels.push(paymentModel);
    }
    return paymentModels;
  }

  getPaymentById(paymentId: string): PaymentModel {
    const payment = this.#paymentPerId.get(paymentId);
    if (!payment) {
      throw Error(`A payment is not in the model. Payment id = ${paymentId}`);
    }
    return payment;
  }

  get totalBalance(): number {
    return this.#totalBalance;
  }

  get totalConfirmedAmount(): number {
    return this.#totalConfirmedAmount;
  }

  get totalUnconfirmedRemainder(): number {
    return this.#totalUnconfirmedRemainder;
  }

  get defaultCashbackRate(): number {
    return this.#cashbackRate;
  }

  get capPeriodStartAmount(): number {
    return this.#capPeriodStartAmount;
  }

  set capPeriodStartAmount(startAmount: number) {
    this.#capPeriodStartAmount = startAmount;
  }

  getPaymentOperation(operationIndex: number): PaymentOperation {
    return this.#getOperationByIndex(this.#paymentOperations, operationIndex, "");
  }

  setCashbackIncreaseStatus(newStatus: CashbackOperationStatus) {
    this.#cashbackIncreaseStatus = newStatus;
  }

  setCashbackIncreaseAmountResult(newAmountResult: number) {
    this.#cashbackIncreaseAmountResult = newAmountResult;
  }

  setCashbackRevocationStatus(newStatus: CashbackOperationStatus) {
    this.#cashbackRevocationStatus = newStatus;
  }

  setCashbackSendingStatus(newStatus: CashbackOperationStatus) {
    this.#cashbackSendingStatus = newStatus;
  }

  setCashbackSendingAmountResult(newAmountResult: number) {
    this.#cashbackSendingAmountResult = newAmountResult;
  }

  calculateCashback(baseAmount: number, refundAmount?: number, cashbackRate?: number) {
    refundAmount = refundAmount ?? 0;
    cashbackRate = cashbackRate ?? this.#cashbackRate;
    if (baseAmount < refundAmount) {
      return 0;
    }
    const amount = baseAmount - refundAmount;
    const cashback = Math.floor(amount * cashbackRate / CASHBACK_FACTOR);
    return this.#roundCashback(cashback, CASHBACK_ROUNDING_COEF);
  }

  getCashbackTotalForAccount(account: string): number {
    return this.#cashbackTotalPerAccount.get(account) ?? 0;
  }

  #createPayment(payment: TestPayment): PaymentModel {
    const currentPayment: PaymentModel | undefined = this.#paymentPerId.get(payment.id);
    if (currentPayment && currentPayment.status != PaymentStatus.Revoked) {
      throw new Error(
        `A payment with the provided ID already exists in the model and its status is not "Revoked".` +
        `Payment id=${payment.id}`,
      );
    }
    return {
      paymentId: payment.id,
      status: PaymentStatus.Active,
      payer: payment.payer,
      cashbackEnabled: this.#cashbackEnabled,
      cashbackRate: this.#cashbackRate,
      confirmedAmount: 0,
      sponsor: undefined,
      subsidyLimit: 0,
      baseAmount: payment.baseAmount,
      extraAmount: payment.extraAmount,
      cashbackAmount: 0,
      refundAmount: 0,
    };
  }

  #createPaymentOperation(payment: PaymentModel, kind: OperationKind): PaymentOperation {
    const remainder = payment.baseAmount + payment.extraAmount - payment.refundAmount;
    const amountParts: AmountParts =
      this.#defineAmountParts(payment.baseAmount, payment.extraAmount, payment.subsidyLimit);
    const refundParts: RefundParts =
      this.#defineRefundParts(payment.refundAmount, payment.baseAmount, payment.subsidyLimit);
    const sponsorRemainder: number = amountParts.sponsorSumAmount - refundParts.sponsorRefundAmount;
    return {
      kind,
      paymentId: payment.paymentId,
      paymentStatus: payment.status,
      sender: undefined,
      payer: payment.payer,
      oldBaseAmount: payment.baseAmount,
      newBaseAmount: payment.baseAmount,
      oldExtraAmount: payment.extraAmount,
      newExtraAmount: payment.extraAmount,
      oldConfirmationAmount: payment.confirmedAmount,
      newConfirmationAmount: payment.confirmedAmount,
      oldRefundAmount: payment.refundAmount,
      newRefundAmount: payment.refundAmount,
      oldRemainder: remainder,
      newRemainder: remainder,
      oldPayerSumAmount: amountParts.payerSumAmount,
      newPayerSumAmount: amountParts.sponsorSumAmount,
      oldPayerRefundAmount: refundParts.payerRefundAmount,
      newPayerRefundAmount: refundParts.payerRefundAmount,
      oldPayerRemainder: remainder - sponsorRemainder,
      newPayerRemainder: remainder - sponsorRemainder,
      cashbackEnabled: payment.cashbackEnabled,
      oldCashbackAmount: payment.cashbackAmount,
      cashbackOperationKind: CashbackOperationKind.Undefined,
      cashbackOperationStatus: CashbackOperationStatus.Undefined,
      cashbackRequestedChange: 0,
      cashbackActualChange: 0,
      cashbackRate: payment.cashbackRate,
      sponsor: payment.sponsor,
      subsidyLimit: payment.subsidyLimit,
      oldSponsorSumAmount: amountParts.sponsorSumAmount,
      newSponsorSumAmount: amountParts.sponsorSumAmount,
      oldSponsorRefundAmount: refundParts.sponsorRefundAmount,
      newSponsorRefundAmount: refundParts.sponsorRefundAmount,
      oldSponsorRemainder: sponsorRemainder,
      newSponsorRemainder: sponsorRemainder,
      senderBalanceChange: 0,
      cardPaymentProcessorBalanceChange: 0,
      cashOutAccountBalanceChange: 0,
      payerBalanceChange: 0,
      sponsorBalanceChange: 0,
      updatingOperationKind: UpdatingOperationKind.Full,
      relatedPaymentIds: [],
    };
  }

  #definePaymentOperation(operation: PaymentOperation) {
    const newAmountParts: AmountParts =
      this.#defineAmountParts(operation.newBaseAmount, operation.newExtraAmount, operation.subsidyLimit);
    const newRefundParts: RefundParts =
      this.#defineRefundParts(operation.newRefundAmount, operation.newBaseAmount, operation.subsidyLimit);
    const oldPayerRemainder: number = operation.oldRemainder - operation.oldSponsorRemainder;
    const newPayerRemainder: number = newAmountParts.payerSumAmount - newRefundParts.payerRefundAmount;
    const newSponsorRemainder: number = newAmountParts.sponsorSumAmount - newRefundParts.sponsorRefundAmount;
    const newRemainder: number = operation.newBaseAmount + operation.newExtraAmount - operation.newRefundAmount;
    if (newRemainder < operation.newConfirmationAmount) {
      operation.newConfirmationAmount = newRemainder;
    }

    operation.newRemainder = newRemainder;
    operation.newPayerSumAmount = newAmountParts.payerSumAmount;
    operation.newSponsorSumAmount = newAmountParts.sponsorSumAmount;
    operation.newPayerRefundAmount = newRefundParts.payerRefundAmount;
    operation.newSponsorRefundAmount = newRefundParts.sponsorRefundAmount;
    operation.newPayerRemainder = newPayerRemainder;
    operation.newSponsorRemainder = newSponsorRemainder;
    operation.payerBalanceChange = oldPayerRemainder - newPayerRemainder;
    operation.sponsorBalanceChange = operation.oldSponsorRemainder - newSponsorRemainder;
    operation.cardPaymentProcessorBalanceChange -= (operation.payerBalanceChange + operation.sponsorBalanceChange);
    operation.cardPaymentProcessorBalanceChange -=
      (operation.newConfirmationAmount - operation.oldConfirmationAmount);
    operation.cashOutAccountBalanceChange = operation.newConfirmationAmount - operation.oldConfirmationAmount;

    this.#defineCashbackOperation(operation);

    if (!operation.cashbackEnabled) {
      return;
    }

    if (
      operation.cashbackOperationKind == CashbackOperationKind.Increase ||
      operation.cashbackOperationKind == CashbackOperationKind.Sending
    ) {
      operation.payerBalanceChange += operation.cashbackActualChange;
    }
    if (operation.cashbackOperationKind == CashbackOperationKind.Revocation) {
      operation.payerBalanceChange += operation.cashbackRequestedChange;
      operation.cardPaymentProcessorBalanceChange -=
        (operation.cashbackRequestedChange - operation.cashbackActualChange);
    }

    if (operation.sender === operation.payer) {
      operation.senderBalanceChange = operation.payerBalanceChange;
    }
  }

  #defineCashbackOperation(operation: PaymentOperation) {
    if (!operation.cashbackEnabled) {
      operation.cashbackRate = 0;
      operation.cashbackOperationKind = CashbackOperationKind.None;
      operation.cashbackOperationStatus = CashbackOperationStatus.Undefined;
      operation.cashbackRequestedChange = 0;
      operation.cashbackActualChange = 0;
      return;
    }
    if (operation.cashbackOperationKind !== CashbackOperationKind.None) {
      const newAmountParts: AmountParts =
        this.#defineAmountParts(operation.newBaseAmount, operation.newExtraAmount, operation.subsidyLimit);
      const refundParts: RefundParts =
        this.#defineRefundParts(operation.newRefundAmount, operation.newBaseAmount, operation.subsidyLimit);
      const newCashbackAmount = this.calculateCashback(
        newAmountParts.payerBaseAmount,
        refundParts.payerRefundAmount,
        operation.cashbackRate,
      );
      operation.cashbackRequestedChange = newCashbackAmount - operation.oldCashbackAmount;
    }
    if (operation.cashbackOperationKind === CashbackOperationKind.Undefined) {
      if (operation.cashbackRequestedChange > 0) {
        operation.cashbackOperationKind = CashbackOperationKind.Increase;
      } else if (operation.cashbackRequestedChange < 0) {
        operation.cashbackOperationKind = CashbackOperationKind.Revocation;
      } else {
        operation.cashbackOperationKind = CashbackOperationKind.None;
      }
    }
    operation.cashbackActualChange = 0;
    operation.cashbackOperationStatus = CashbackOperationStatus.Undefined;
    if (operation.cashbackOperationKind == CashbackOperationKind.Increase) {
      operation.cashbackOperationStatus = this.#cashbackIncreaseStatus;
      if (
        operation.cashbackOperationStatus === CashbackOperationStatus.Success ||
        operation.cashbackOperationStatus === CashbackOperationStatus.Partial
      ) {
        if (this.#cashbackIncreaseAmountResult < 0) {
          operation.cashbackActualChange = operation.cashbackRequestedChange;
        } else {
          operation.cashbackActualChange = this.#cashbackIncreaseAmountResult;
          if (operation.cashbackRequestedChange > operation.cashbackActualChange) {
            operation.cashbackOperationStatus = CashbackOperationStatus.Partial;
          }
        }
      }
    } else if (operation.cashbackOperationKind == CashbackOperationKind.Revocation) {
      operation.cashbackOperationStatus = this.#cashbackRevocationStatus;
      if (operation.cashbackOperationStatus === CashbackOperationStatus.Success) {
        operation.cashbackActualChange = operation.cashbackRequestedChange;
      }
    } else if (operation.cashbackOperationKind == CashbackOperationKind.Sending) {
      if (operation.cashbackRequestedChange < 0) {
        throw new Error("The cashback amount change is negative during the cashback sending operation");
      }
      operation.cashbackOperationStatus = this.#cashbackSendingStatus;
      if (
        operation.cashbackOperationStatus === CashbackOperationStatus.Success ||
        operation.cashbackOperationStatus === CashbackOperationStatus.Partial
      ) {
        if (this.#cashbackSendingAmountResult < 0) {
          operation.cashbackActualChange = operation.cashbackRequestedChange;
        } else {
          operation.cashbackActualChange = this.#cashbackSendingAmountResult;
          if (operation.cashbackRequestedChange > operation.cashbackActualChange) {
            operation.cashbackOperationStatus = CashbackOperationStatus.Partial;
          }
        }
      }
    }

    // Check the periodic cap
    if (
      operation.cashbackOperationStatus === CashbackOperationStatus.Success ||
      operation.cashbackOperationStatus === CashbackOperationStatus.Partial
    ) {
      const totalCashback =
        (this.#cashbackTotalPerAccount.get(operation.payer.address) ?? 0) - this.#capPeriodStartAmount;
      if (totalCashback + operation.cashbackActualChange > MAX_CASHBACK_FOR_CAP_PERIOD) {
        if (totalCashback >= MAX_CASHBACK_FOR_CAP_PERIOD) {
          operation.cashbackActualChange = 0;
          operation.cashbackOperationStatus = CashbackOperationStatus.Capped;
        } else {
          operation.cashbackActualChange = MAX_CASHBACK_FOR_CAP_PERIOD - totalCashback;
          operation.cashbackOperationStatus = CashbackOperationStatus.Partial;
        }
      }
    }
  }

  #registerPaymentOperation(operation: PaymentOperation, payment: PaymentModel): number {
    payment.baseAmount = operation.newBaseAmount;
    payment.extraAmount = operation.newExtraAmount;
    payment.refundAmount = operation.newRefundAmount;
    payment.confirmedAmount = operation.newConfirmationAmount;
    payment.cashbackAmount += operation.cashbackActualChange;
    this.#totalBalance += operation.cardPaymentProcessorBalanceChange;
    this.#totalConfirmedAmount += operation.cashOutAccountBalanceChange;
    this.#totalUnconfirmedRemainder += (operation.newRemainder - operation.oldRemainder);
    this.#totalUnconfirmedRemainder -= (operation.newConfirmationAmount - operation.oldConfirmationAmount);
    const totalCashback = this.#cashbackTotalPerAccount.get(operation.payer.address) ?? 0;
    this.#cashbackTotalPerAccount.set(operation.payer.address, totalCashback + operation.cashbackActualChange);
    return this.#paymentOperations.push(operation) - 1;
  }

  #registerPaymentMakingOperation(operation: PaymentOperation, payment: PaymentModel): number {
    payment.cashbackEnabled = operation.cashbackEnabled;
    payment.cashbackRate = operation.cashbackRate;
    if (operation.sponsor) {
      payment.sponsor = operation.sponsor;
      payment.subsidyLimit = operation.subsidyLimit;
    }
    this.#paymentPerId.set(payment.paymentId, payment);
    this.#paymentMakingOperations.push(operation);
    return this.#registerPaymentOperation(operation, payment);
  }

  #roundCashback(cashback: number, roundingCoefficient: number): number {
    return Math.floor(Math.floor(cashback + roundingCoefficient / 2) / roundingCoefficient) * roundingCoefficient;
  }

  #getPaymentByMakingOperationIndex(paymentMakingOperationIndex: number): PaymentModel {
    const paymentOperation: PaymentOperation = this.#paymentMakingOperations[paymentMakingOperationIndex];
    const paymentId = paymentOperation.paymentId;
    return this.getPaymentById(paymentId);
  }

  #checkPaymentUpdating(operation: PaymentOperation) {
    if (operation.paymentStatus !== PaymentStatus.Active) {
      throw new Error(
        `The payment has inappropriate status: ${operation.paymentStatus}`,
      );
    }
    if (operation.newRefundAmount > operation.newBaseAmount + operation.newExtraAmount) {
      throw new Error(
        `The new sum amount is wrong for the payment with the id=${operation.paymentId}. ` +
        `The new sum amount: ${operation.newBaseAmount + operation.newExtraAmount}. ` +
        `The old sum amount: ${operation.oldBaseAmount + operation.oldExtraAmount}. ` +
        `The payment refund amount: ${operation.newRefundAmount}`,
      );
    }
  }

  #getOperationByIndex(operations: PaymentOperation[], index: number, kind: string): PaymentOperation {
    if (index < 0) {
      index = operations.length + index;
    }
    if (index >= operations.length) {
      throw new Error(
        `A payment ${kind} operation with index ${index} does not exist. `,
      );
    }
    return operations[index];
  }

  #checkPaymentCanceling(operation: PaymentOperation) {
    if (operation.paymentStatus !== PaymentStatus.Active) {
      throw new Error(
        `The payment has inappropriate status: ${operation.paymentStatus}`,
      );
    }
  }

  #updateModelDueToPaymentCancelingOperation(operation: PaymentOperation) {
    this.#totalBalance += operation.cardPaymentProcessorBalanceChange;
    this.#totalConfirmedAmount += operation.cashOutAccountBalanceChange;
    this.#totalUnconfirmedRemainder += (operation.newRemainder - operation.oldRemainder);
    this.#totalUnconfirmedRemainder -= (operation.newConfirmationAmount - operation.oldConfirmationAmount);
    const totalCashback = this.#cashbackTotalPerAccount.get(operation.payer.address) ?? 0;
    this.#cashbackTotalPerAccount.set(operation.payer.address, totalCashback + operation.cashbackActualChange);
  }

  #registerPaymentCancelingOperation(operation: PaymentOperation, payment: PaymentModel, targetStatus: PaymentStatus) {
    payment.status = targetStatus;
    payment.cashbackAmount += operation.cashbackActualChange;
    return this.#paymentOperations.push(operation) - 1;
  }

  #checkPaymentConfirming(operation: PaymentOperation) {
    if (operation.paymentStatus !== PaymentStatus.Active) {
      throw new Error(
        `The payment has inappropriate status: ${operation.paymentStatus}`,
      );
    }
    const remainder: number = operation.newBaseAmount + operation.newExtraAmount - operation.newRefundAmount;
    if (operation.newConfirmationAmount > remainder) {
      throw new Error(
        `The confirmation amount is wrong for the payment with id=${operation.paymentId}. ` +
        `The old payment confirmed amount: ${operation.oldConfirmationAmount}. ` +
        `The new confirmation amount: ${operation.newConfirmationAmount}. ` +
        `The payment remainder: ${remainder}.`,
      );
    }
  }

  #checkPaymentRefunding(operation: PaymentOperation) {
    if (operation.paymentStatus !== PaymentStatus.Active) {
      throw new Error(
        `The payment has inappropriate status: ${operation.paymentStatus}`,
      );
    }
    if (operation.newRefundAmount > (operation.newBaseAmount + operation.newExtraAmount)) {
      throw new Error(
        `The new refund amount is wrong for the payment with id=${operation.paymentId}. ` +
        `The old refund amount: ${operation.oldRefundAmount}. ` +
        `The new refund amount: ${operation.newRefundAmount}. ` +
        `The payment sum amount: ${operation.newBaseAmount + operation.newExtraAmount}`,
      );
    }
  }

  #defineAmountParts(paymentBaseAmount: number, paymentExtraAmount: number, subsidyLimit: number): AmountParts {
    const result: AmountParts = {
      payerBaseAmount: paymentBaseAmount,
      payerExtraAmount: paymentExtraAmount,
      payerSumAmount: paymentBaseAmount + paymentExtraAmount,
      sponsorBaseAmount: 0,
      sponsorExtraAmount: 0,
      sponsorSumAmount: 0,
    };
    if (subsidyLimit >= (paymentBaseAmount + paymentExtraAmount)) {
      result.sponsorBaseAmount = paymentBaseAmount;
      result.payerBaseAmount = 0;
      result.sponsorExtraAmount = paymentExtraAmount;
      result.payerExtraAmount = 0;
    } else if (subsidyLimit >= paymentBaseAmount) {
      result.sponsorBaseAmount = paymentBaseAmount;
      result.payerBaseAmount = 0;
      result.sponsorExtraAmount = subsidyLimit - paymentBaseAmount;
      result.payerExtraAmount = paymentExtraAmount - result.sponsorExtraAmount;
    } else {
      result.sponsorBaseAmount = subsidyLimit;
      result.payerBaseAmount = paymentBaseAmount - result.sponsorBaseAmount;
      result.sponsorExtraAmount = 0;
      result.payerExtraAmount = paymentExtraAmount;
    }
    result.payerSumAmount = result.payerBaseAmount + result.payerExtraAmount;
    result.sponsorSumAmount = result.sponsorBaseAmount + result.sponsorExtraAmount;
    return result;
  }

  #defineRefundParts(paymentRefundAmount: number, paymentBaseAmount: number, subsidyLimit: number): RefundParts {
    let sponsorRefundAmount;
    if (subsidyLimit === 0) {
      sponsorRefundAmount = 0;
    } else if (subsidyLimit >= paymentBaseAmount) {
      sponsorRefundAmount = paymentRefundAmount;
    } else {
      sponsorRefundAmount = Math.floor(paymentRefundAmount * subsidyLimit / paymentBaseAmount);
      if (sponsorRefundAmount > subsidyLimit) {
        sponsorRefundAmount = subsidyLimit;
      }
    }
    return {
      payerRefundAmount: paymentRefundAmount - sponsorRefundAmount,
      sponsorRefundAmount,
    };
  }
}

interface OperationResult {
  operationIndex: number;
  tx: Promise<TransactionResponse>;
  txReceipt: TransactionReceipt;
}

interface OperationConditions {
  confirmationAmountChangedInAnyOperation: boolean;
  cashbackSendingRequestedInAnyOperation: boolean;
  cashbackIncreaseRequestedInAnyOperation: boolean;
  cashbackRevocationRequestedInAnyOperation: boolean;
}

interface Version {
  major: number;
  minor: number;
  patch: number;

  [key: string]: number; // Indexing signature to ensure that fields are iterated over in a key-value style
}

class CardPaymentProcessorShell {
  contract: Contract;
  cashbackControllerContract: Contract;
  model: CardPaymentProcessorModel;
  executor: HardhatEthersSigner;

  constructor(props: {
    cardPaymentProcessorContract: Contract;
    cashbackControllerContract: Contract;
    cardPaymentProcessorModel: CardPaymentProcessorModel;
    executor: HardhatEthersSigner;
  }) {
    this.contract = props.cardPaymentProcessorContract;
    this.cashbackControllerContract = props.cashbackControllerContract;
    this.model = props.cardPaymentProcessorModel;
    this.executor = props.executor;
  }

  async disableCashback() {
    this.model.disableCashback();
    await proveTx(this.contract.setDefaultCashbackRate(0));
  }

  async makeCommonPayments(
    payments: TestPayment[],
    sender: HardhatEthersSigner = this.executor,
  ): Promise<OperationResult[]> {
    const operationResults: OperationResult[] = [];
    for (const payment of payments) {
      const operationIndex = this.model.makePayment(payment, { sender });
      const tx = (this.contract.connect(sender) as Contract).makeCommonPaymentFor(
        payment.id,
        payment.payer.address,
        payment.baseAmount,
        payment.extraAmount,
      );
      const txReceipt: TransactionReceipt = await proveTx(tx);
      operationResults.push({
        operationIndex,
        tx,
        txReceipt,
      });
    }
    return operationResults;
  }

  async makePaymentFor(
    payment: TestPayment,
    props: {
      sponsor?: HardhatEthersSigner;
      subsidyLimit?: number;
      cashbackRate?: number;
      confirmationAmount?: number;
      sender?: HardhatEthersSigner;
    } = {},
  ): Promise<OperationResult> {
    if (!props.sender) {
      props.sender = this.executor;
    }
    if (!props.subsidyLimit) {
      props.sponsor = undefined;
    }
    const operationIndex = this.model.makePayment(payment, props);
    const tx = (this.contract.connect(props.sender) as Contract).makePaymentFor(
      payment.id,
      payment.payer.address,
      payment.baseAmount,
      payment.extraAmount,
      props.sponsor?.address ?? ZERO_SPONSOR_ADDRESS,
      props.subsidyLimit ?? 0,
      props.cashbackRate ?? CASHBACK_RATE_AS_IN_CONTRACT,
      props.confirmationAmount ?? 0,
    );
    const txReceipt: TransactionReceipt = await proveTx(tx);
    return {
      operationIndex,
      tx,
      txReceipt,
    };
  }

  async updatePayment(
    payment: TestPayment,
    newBaseAmount: number,
    newExtraAmount: number = payment.extraAmount,
    sender: HardhatEthersSigner = this.executor,
  ): Promise<OperationResult> {
    const operationIndex = this.model.updatePayment(
      payment.id,
      newBaseAmount,
      newExtraAmount,
      UpdatingOperationKind.Full,
    );
    const tx = (this.contract.connect(sender) as Contract).updatePayment(
      payment.id,
      newBaseAmount,
      newExtraAmount,
    );
    const txReceipt: TransactionReceipt = await proveTx(tx);
    return {
      operationIndex,
      tx,
      txReceipt,
    };
  }

  async revokePayment(
    payment: TestPayment,
    sender: HardhatEthersSigner = this.executor,
  ): Promise<OperationResult> {
    const operationIndex = this.model.revokePayment(payment.id);
    const tx = (this.contract.connect(sender) as Contract).revokePayment(payment.id);
    const txReceipt: TransactionReceipt = await proveTx(tx);
    return {
      operationIndex,
      tx,
      txReceipt,
    };
  }

  async reversePayment(
    payment: TestPayment,
    sender: HardhatEthersSigner = this.executor,
  ): Promise<OperationResult> {
    const operationIndex = this.model.reversePayment(payment.id);
    const tx = (this.contract.connect(sender) as Contract).reversePayment(payment.id);
    const txReceipt: TransactionReceipt = await proveTx(tx);
    return {
      operationIndex,
      tx,
      txReceipt,
    };
  }

  async confirmPayment(
    payment: TestPayment,
    confirmationAmount: number,
    sender: HardhatEthersSigner = this.executor,
  ): Promise<OperationResult> {
    const operationIndex = this.model.confirmPayment(payment.id, confirmationAmount);
    const tx = (this.contract.connect(sender) as Contract).confirmPayment(payment.id, confirmationAmount);
    const txReceipt: TransactionReceipt = await proveTx(tx);
    return {
      operationIndex,
      tx,
      txReceipt,
    };
  }

  async refundPayment(
    payment: TestPayment,
    refundAmount: number,
    sender: HardhatEthersSigner = this.executor,
  ): Promise<OperationResult> {
    const operationIndex = this.model.refundPayment(
      payment.id,
      refundAmount,
    );
    const contractConnected = this.contract.connect(sender) as Contract;
    const tx = contractConnected.refundPayment(payment.id, refundAmount);
    const txReceipt: TransactionReceipt = await proveTx(tx);
    return {
      operationIndex,
      tx,
      txReceipt,
    };
  }
}

function encodeEventAddendumFieldForAmount(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`The provided amount is not valid for encoding as an addendum field of an event: ${amount}`);
  }
  return amount.toString(16).padStart(EVENT_ADDENDUM_CHARS_FOR_AMOUNT, "0");
}

function encodeEventAddendumFieldForAddress(address: string | undefined): string {
  if (!address) {
    throw new Error(`The provided address is not valid for encoding as an addendum field of an event: ${address}`);
  }
  if (address.startsWith("0x")) {
    if (address.length != 42) {
      throw new Error(`The provided address is not valid for encoding as an addendum field of an event: ${address}`);
    }
    return address.slice(2);
  } else {
    if (address.length != 40) {
      throw new Error(`The provided address is not valid for encoding as an addendum field of an event: ${address}`);
    }
    return address;
  }
}

function defineEventAddendum(...parts: string[]): string {
  return "0x" + parts.join("");
}

class TestContext {
  tokenMock: Contract;
  cardPaymentProcessorShell: CardPaymentProcessorShell;
  cashOutAccount: HardhatEthersSigner;
  cashbackTreasury: HardhatEthersSigner;
  payments: TestPayment[];

  constructor(props: {
    fixture: Fixture;
    cashbackRateInPermil: number;
    cashbackEnabled: boolean;
    cashOutAccount: HardhatEthersSigner;
    cashbackTreasury: HardhatEthersSigner;
    cardPaymentProcessorExecutor: HardhatEthersSigner;
    payments: TestPayment[];
  }) {
    this.tokenMock = props.fixture.tokenMock;
    this.cardPaymentProcessorShell = new CardPaymentProcessorShell({
      cardPaymentProcessorContract: props.fixture.cardPaymentProcessor,
      cardPaymentProcessorModel: new CardPaymentProcessorModel({
        cashbackRate: props.cashbackRateInPermil,
        cashbackEnabled: props.cashbackEnabled,
      }),
      executor: props.cardPaymentProcessorExecutor,
      cashbackControllerContract: props.fixture.cashbackController,
    });
    this.cashOutAccount = props.cashOutAccount;
    this.cashbackTreasury = props.cashbackTreasury;
    this.payments = props.payments;
  }

  async setUpContractsForPayments(payments: TestPayment[] = this.payments) {
    const accounts = new Set<HardhatEthersSigner>(payments.map(payment => payment.payer));
    for (const account of accounts) {
      await proveTx(this.tokenMock.mint(account.address, INITIAL_USER_BALANCE));
    }
    for (const contract of [
      this.cardPaymentProcessorShell.contract,
      this.cardPaymentProcessorShell.cashbackControllerContract,
    ]) {
      for (const account of accounts) {
        const allowance: bigint = await this.tokenMock.allowance(
          account.address,
          getAddress(contract),
        );
        if (allowance < MAX_UINT256) {
          await proveTx(
            (this.tokenMock.connect(account) as Contract).approve(
              getAddress(contract),
              MAX_UINT256,
            ),
          );
        }
      }
    }
  }

  async checkPaymentOperationsForTx(tx: Promise<TransactionResponse>, paymentOperationIndexes: number[] = [-1]) {
    const operations: PaymentOperation[] = paymentOperationIndexes.map(
      index => this.cardPaymentProcessorShell.model.getPaymentOperation(index),
    );
    const operationConditions: OperationConditions = this.defineOperationConditions(operations);
    for (const operation of operations) {
      await this.checkMainEvents(tx, operation);
      await this.checkConfirmationEvents(tx, operation, operationConditions);
      await this.checkCashbackEvents(
        operation,
        tx,
        operationConditions,
      );
    }

    await this.checkBalanceChanges(tx, operations);
  }

  defineOperationConditions(operations: PaymentOperation[]): OperationConditions {
    const result: OperationConditions = {
      cashbackIncreaseRequestedInAnyOperation: false,
      cashbackRevocationRequestedInAnyOperation: false,
      cashbackSendingRequestedInAnyOperation: false,
      confirmationAmountChangedInAnyOperation: false,
    };
    operations.forEach((operation) => {
      if (operation.cashbackOperationKind == CashbackOperationKind.Sending) {
        result.cashbackSendingRequestedInAnyOperation = true;
      } else if (operation.cashbackOperationKind == CashbackOperationKind.Increase) {
        result.cashbackIncreaseRequestedInAnyOperation = true;
      } else if (operation.cashbackOperationKind == CashbackOperationKind.Revocation) {
        result.cashbackRevocationRequestedInAnyOperation = true;
      }
      if (operation.newConfirmationAmount != operation.oldConfirmationAmount) {
        result.confirmationAmountChangedInAnyOperation = true;
      }
    });

    return result;
  }

  async checkMainEvents(
    tx: Promise<TransactionResponse>,
    operation: PaymentOperation,
  ) {
    switch (operation.kind) {
      case OperationKind.Undefined:
        break;
      case OperationKind.Making:
        await this.checkMakingEvents(tx, operation);
        break;
      case OperationKind.Updating:
        await this.checkUpdatingEvents(tx, operation);
        break;
      case OperationKind.Revoking:
        await this.checkCancelingEvents(tx, operation);
        break;
      case OperationKind.Reversing:
        await this.checkCancelingEvents(tx, operation);
        break;
      case OperationKind.Confirming:
        // Do nothing. It will be checked in another function.
        break;
      case OperationKind.Refunding:
        await this.checkRefundingEvents(tx, operation);
        break;
      default:
        throw new Error(
          `An unknown operation kind was found: ${operation.kind}`,
        );
    }
  }

  async checkConfirmationEvents(
    tx: Promise<TransactionResponse>,
    operation: PaymentOperation,
    operationConditions: OperationConditions,
  ) {
    const expectedAddendum: string = defineEventAddendum(
      EVENT_ADDENDUM_VERSION_DEFAULT_VALUE,
      !operation.sponsor ? EVENT_ADDENDUM_FLAGS_NON_SUBSIDIZED : EVENT_ADDENDUM_FLAGS_SUBSIDIZED,
      encodeEventAddendumFieldForAmount(operation.oldConfirmationAmount),
      encodeEventAddendumFieldForAmount(operation.newConfirmationAmount),
      !operation.sponsor ? "" : encodeEventAddendumFieldForAddress(operation.sponsor?.address),
    );

    if (operation.newConfirmationAmount != operation.oldConfirmationAmount) {
      await expect(tx).to.emit(this.cardPaymentProcessorShell.contract, EVENT_NAME_PAYMENT_CONFIRMED_AMOUNT_CHANGED)
        .withArgs(
          checkEventParameter("paymentId", operation.paymentId),
          checkEventParameter("payer", operation.payer.address),
          checkEventParameter("addendum", expectedAddendum, eventAddendumCheckingOptions),
        );
    } else if (operationConditions.confirmationAmountChangedInAnyOperation) {
      await expect(tx).to.emit(this.cardPaymentProcessorShell.contract, EVENT_NAME_PAYMENT_CONFIRMED_AMOUNT_CHANGED)
        .withArgs(
          checkEventParameter("paymentId", operation.paymentId),
          checkEventParameter("payer", operation.payer.address),
          checkEventParameterNotEqual("addendum", expectedAddendum, eventAddendumCheckingOptions),
        );
    } else {
      await expect(tx)
        .not.to.emit(this.cardPaymentProcessorShell.contract, EVENT_NAME_PAYMENT_CONFIRMED_AMOUNT_CHANGED);
    }
  }

  async checkCashbackEvents(
    operation: PaymentOperation,
    tx: Promise<TransactionResponse>,
    operationConditions: OperationConditions,
  ) {
    if (operation.cashbackOperationKind === CashbackOperationKind.Sending) {
      await expect(tx).to.emit(this.cardPaymentProcessorShell.cashbackControllerContract, EVENT_NAME_CASHBACK_SENT)
        .withArgs(
          checkEventParameter("paymentId", operation.paymentId),
          checkEventParameter("recipient", operation.payer.address),
          checkEventParameter("status", operation.cashbackOperationStatus),
          checkEventParameter("amount", operation.cashbackActualChange),
        );
    }

    if (operation.cashbackOperationKind === CashbackOperationKind.Revocation) {
      await expect(tx).to.emit(
        this.cardPaymentProcessorShell.cashbackControllerContract,
        EVENT_NAME_CASHBACK_DECREASED,
      ).withArgs(
        checkEventParameter("paymentId", operation.paymentId),
        checkEventParameter("recipient", operation.payer.address),
        checkEventParameter("status", operation.cashbackOperationStatus),
        checkEventParameter("delta", -operation.cashbackActualChange),
        checkEventParameter("balance", operation.oldCashbackAmount + operation.cashbackActualChange),
      );
    }

    if (operation.cashbackOperationKind === CashbackOperationKind.Increase) {
      await expect(tx).to.emit(this.cardPaymentProcessorShell.cashbackControllerContract, EVENT_NAME_CASHBACK_INCREASED)
        .withArgs(
          checkEventParameter("paymentId", operation.paymentId),
          checkEventParameter("recipient", operation.payer.address),
          checkEventParameter("status", operation.cashbackOperationStatus),
          checkEventParameter("delta", operation.cashbackActualChange),
          checkEventParameter("balance", operation.oldCashbackAmount + operation.cashbackActualChange),
        );
    }

    if (!operationConditions.cashbackSendingRequestedInAnyOperation) {
      await expect(tx)
        .not.to.emit(this.cardPaymentProcessorShell.cashbackControllerContract, EVENT_NAME_CASHBACK_SENT);
    }

    if (!operationConditions.cashbackIncreaseRequestedInAnyOperation) {
      await expect(tx)
        .not.to.emit(this.cardPaymentProcessorShell.cashbackControllerContract, EVENT_NAME_CASHBACK_INCREASED);
    }

    if (!operationConditions.cashbackRevocationRequestedInAnyOperation) {
      await expect(tx)
        .not.to.emit(this.cardPaymentProcessorShell.cashbackControllerContract, EVENT_NAME_CASHBACK_DECREASED);
    }
  }

  private async checkBalanceChanges(tx: Promise<TransactionResponse>, operations: PaymentOperation[]) {
    const cardPaymentProcessorBalanceChange = operations
      .map(operation => operation.cardPaymentProcessorBalanceChange)
      .reduce((sum: number, currentValue: number) => sum + currentValue);
    const cashbackTreasuryBalanceChange = operations
      .map(operation => -operation.cashbackActualChange)
      .reduce((sum: number, currentValue: number) => sum + currentValue);
    const cashOutAccountBalanceChange = operations
      .map(operation => operation.cashOutAccountBalanceChange)
      .reduce((sum: number, currentValue: number) => sum + currentValue);
    const balanceChangePerAccount: Map<HardhatEthersSigner, number> = this.#getBalanceChangePerAccount(operations);
    const accounts: HardhatEthersSigner[] = Array.from(balanceChangePerAccount.keys());
    const accountBalanceChanges: number[] = accounts.map(user => balanceChangePerAccount.get(user) ?? 0);

    await expect(tx).to.changeTokenBalances(
      this.tokenMock,
      [
        this.cardPaymentProcessorShell.contract,
        this.cashOutAccount,
        this.cashbackTreasury,
        ...accounts,
      ],
      [
        cardPaymentProcessorBalanceChange,
        cashOutAccountBalanceChange,
        cashbackTreasuryBalanceChange,
        ...accountBalanceChanges,
      ],
    );
  }

  async checkCardPaymentProcessorState() {
    await this.#checkPaymentStructures();
    await this.#checkTokenBalances();
  }

  async checkMakingEvents(tx: Promise<TransactionResponse>, operation: PaymentOperation) {
    const expectedAddendum: string = defineEventAddendum(
      EVENT_ADDENDUM_VERSION_DEFAULT_VALUE,
      !operation.sponsor ? EVENT_ADDENDUM_FLAGS_NON_SUBSIDIZED : EVENT_ADDENDUM_FLAGS_SUBSIDIZED,
      encodeEventAddendumFieldForAmount(operation.newBaseAmount),
      encodeEventAddendumFieldForAmount(operation.newExtraAmount),
      encodeEventAddendumFieldForAmount(operation.newPayerSumAmount),
      !operation.sponsor ? "" : encodeEventAddendumFieldForAddress(operation.sponsor?.address),
      !operation.sponsor ? "" : encodeEventAddendumFieldForAmount(operation.newSponsorSumAmount),
    );

    await expect(tx).to.emit(this.cardPaymentProcessorShell.contract, EVENT_NAME_PAYMENT_MADE).withArgs(
      checkEventParameter("paymentId", operation.paymentId),
      checkEventParameter("payer", operation.payer.address),
      checkEventParameter("addendum", expectedAddendum, eventAddendumCheckingOptions),
    );
  }

  async checkUpdatingEvents(tx: Promise<TransactionResponse>, operation: PaymentOperation) {
    if (
      operation.updatingOperationKind === UpdatingOperationKind.Full ||
      operation.newBaseAmount !== operation.oldBaseAmount ||
      operation.newExtraAmount !== operation.oldExtraAmount
    ) {
      const expectedAddendum: string = defineEventAddendum(
        EVENT_ADDENDUM_VERSION_DEFAULT_VALUE,
        !operation.sponsor ? EVENT_ADDENDUM_FLAGS_NON_SUBSIDIZED : EVENT_ADDENDUM_FLAGS_SUBSIDIZED,
        encodeEventAddendumFieldForAmount(operation.oldBaseAmount),
        encodeEventAddendumFieldForAmount(operation.newBaseAmount),
        encodeEventAddendumFieldForAmount(operation.oldExtraAmount),
        encodeEventAddendumFieldForAmount(operation.newExtraAmount),
        encodeEventAddendumFieldForAmount(operation.oldPayerSumAmount),
        encodeEventAddendumFieldForAmount(operation.newPayerSumAmount),
        !operation.sponsor ? "" : encodeEventAddendumFieldForAddress(operation.sponsor?.address),
        !operation.sponsor ? "" : encodeEventAddendumFieldForAmount(operation.oldSponsorSumAmount),
        !operation.sponsor ? "" : encodeEventAddendumFieldForAmount(operation.newSponsorSumAmount),
      );

      await expect(tx).to.emit(this.cardPaymentProcessorShell.contract, EVENT_NAME_PAYMENT_UPDATED).withArgs(
        checkEventParameter("paymentId", operation.paymentId),
        checkEventParameter("payer", operation.payer.address),
        checkEventParameter("addendum", expectedAddendum, eventAddendumCheckingOptions),
      );
    } else {
      await expect(tx).not.to.emit(this.cardPaymentProcessorShell.contract, EVENT_NAME_PAYMENT_UPDATED);
    }
  }

  async checkCancelingEvents(
    tx: Promise<TransactionResponse>,
    operation: PaymentOperation,
  ) {
    const mainEventName: string = operation.kind === OperationKind.Revoking
      ? EVENT_NAME_PAYMENT_REVOKED
      : EVENT_NAME_PAYMENT_REVERSED;

    const expectedAddendum: string = defineEventAddendum(
      EVENT_ADDENDUM_VERSION_DEFAULT_VALUE,
      !operation.sponsor ? EVENT_ADDENDUM_FLAGS_NON_SUBSIDIZED : EVENT_ADDENDUM_FLAGS_SUBSIDIZED,
      encodeEventAddendumFieldForAmount(operation.oldBaseAmount),
      encodeEventAddendumFieldForAmount(operation.oldExtraAmount),
      encodeEventAddendumFieldForAmount(operation.oldPayerRemainder),
      !operation.sponsor ? "" : encodeEventAddendumFieldForAddress(operation.sponsor?.address ?? ZERO_ADDRESS),
      !operation.sponsor ? "" : encodeEventAddendumFieldForAmount(operation.oldSponsorRemainder),
    );

    await expect(tx).to.emit(this.cardPaymentProcessorShell.contract, mainEventName).withArgs(
      checkEventParameter("paymentId", operation.paymentId),
      checkEventParameter("payer", operation.payer.address),
      checkEventParameter("addendum", expectedAddendum, eventAddendumCheckingOptions),
    );
  }

  async checkRefundingEvents(tx: Promise<TransactionResponse>, operation: PaymentOperation) {
    const expectedAddendum: string = defineEventAddendum(
      EVENT_ADDENDUM_VERSION_DEFAULT_VALUE,
      !operation.sponsor ? EVENT_ADDENDUM_FLAGS_NON_SUBSIDIZED : EVENT_ADDENDUM_FLAGS_SUBSIDIZED,
      encodeEventAddendumFieldForAmount(operation.oldPayerRefundAmount),
      encodeEventAddendumFieldForAmount(operation.newPayerRefundAmount),
      !operation.sponsor ? "" : encodeEventAddendumFieldForAddress(operation.sponsor?.address ?? ZERO_ADDRESS),
      !operation.sponsor ? "" : encodeEventAddendumFieldForAmount(operation.oldSponsorRefundAmount),
      !operation.sponsor ? "" : encodeEventAddendumFieldForAmount(operation.newSponsorRefundAmount),
    );

    await expect(tx).to.emit(this.cardPaymentProcessorShell.contract, EVENT_NAME_PAYMENT_REFUNDED).withArgs(
      checkEventParameter("paymentId", operation.paymentId),
      checkEventParameter("payer", operation.payer.address),
      checkEventParameter("addendum", expectedAddendum, eventAddendumCheckingOptions),
    );
  }

  async presetCashbackForAccount(account: HardhatEthersSigner, cashbackAmount: number): Promise<OperationResult> {
    const accountCashbackOld: AccountCashbackState =
      await this.cardPaymentProcessorShell.cashbackControllerContract.getAccountCashback(account.address);
    const cashbackAmountDiff = Number(BigInt(cashbackAmount) - accountCashbackOld.totalAmount);
    if (cashbackAmountDiff < 0) {
      throw new Error("Cannot set the expected cashback for account because current cashback is already higher");
    }
    const preliminarilyPaymentAmount = Math.floor(
      cashbackAmountDiff * CASHBACK_FACTOR / this.cardPaymentProcessorShell.model.defaultCashbackRate,
    );
    const payment: TestPayment = {
      id: ethers.id("cashbackPresetPayment"),
      payer: account,
      baseAmount: preliminarilyPaymentAmount,
      extraAmount: 0,
    };

    const operationResult = await this.cardPaymentProcessorShell.makePaymentFor(payment);
    const accountCashbackNew: AccountCashbackState =
      await this.cardPaymentProcessorShell.cashbackControllerContract.getAccountCashback(account.address);
    expect(accountCashbackNew.totalAmount).to.equal(cashbackAmount);

    return operationResult;
  }

  async #checkPaymentStructures() {
    const expectedPayments: PaymentModel[] = this.cardPaymentProcessorShell.model.getPaymentModelsInMakingOrder();
    const paymentNumber = expectedPayments.length;
    const checkedPaymentIds = new Set<string>();
    for (let i = 0; i < paymentNumber; ++i) {
      const expectedPayment: PaymentModel = expectedPayments[i];
      if (checkedPaymentIds.has(expectedPayment.paymentId)) {
        continue;
      }
      checkedPaymentIds.add(expectedPayment.paymentId);
      const actualPayment = await this.cardPaymentProcessorShell.contract.getPayment(expectedPayment.paymentId);
      const actualPaymentCashback =
        await this.cardPaymentProcessorShell.cashbackControllerContract
          .getPaymentCashback(expectedPayment.paymentId);
      this.#checkPaymentsEquality(actualPayment, actualPaymentCashback, expectedPayment, i);
      const expectedTotalCashback =
        this.cardPaymentProcessorShell.model.getCashbackTotalForAccount(expectedPayment.payer.address);
      const actualAccountCashback: AccountCashbackState =
        await this.cardPaymentProcessorShell.cashbackControllerContract
          .getAccountCashback(expectedPayment.payer.address);
      expect(actualAccountCashback.totalAmount).to.equal(expectedTotalCashback);
      expect(actualAccountCashback.capPeriodStartAmount)
        .to.equal(this.cardPaymentProcessorShell.model.capPeriodStartAmount);
    }
  }

  #checkPaymentsEquality(
    actualOnChainPayment: Record<string, unknown>,
    actualPaymentCashback: Record<string, unknown>,
    expectedPayment: PaymentModel,
    paymentIndex: number,
  ) {
    expect(actualOnChainPayment.status).to.equal(
      expectedPayment.status,
      `payment[${paymentIndex}].status is wrong`,
    );
    expect(actualOnChainPayment.reserve1).to.equal(
      0,
      `payment[${paymentIndex}].reserve1 is wrong`,
    );
    expect(actualOnChainPayment.payer).to.equal(
      expectedPayment.payer.address,
      `payment[${paymentIndex}].payer is wrong`,
    );
    expect(actualOnChainPayment.cashbackRate).to.equal(
      expectedPayment.cashbackRate,
      `payment[${paymentIndex}].cashbackRate is wrong`,
    );
    expect(actualOnChainPayment.confirmedAmount).to.equal(
      expectedPayment.confirmedAmount,
      `payment[${paymentIndex}].confirmedAmount is wrong`,
    );
    expect(actualOnChainPayment.sponsor).to.equal(
      expectedPayment.sponsor?.address ?? ZERO_ADDRESS,
      `payment[${paymentIndex}].sponsor is wrong`,
    );
    expect(actualOnChainPayment.subsidyLimit).to.equal(
      expectedPayment.subsidyLimit,
      `payment[${paymentIndex}].subsidyLimit is wrong`,
    );
    expect(actualOnChainPayment.reserve2).to.equal(
      0,
      `payment[${paymentIndex}].reserve2 is wrong`,
    );
    expect(actualOnChainPayment.baseAmount).to.equal(
      expectedPayment.baseAmount,
      `payment[${paymentIndex}].baseAmount is wrong`,
    );
    expect(actualOnChainPayment.extraAmount).to.equal(
      expectedPayment.extraAmount,
      `payment[${paymentIndex}].extraAmount is wrong`,
    );
    expect(actualOnChainPayment.reserve3).to.equal(
      0,
      `payment[${paymentIndex}].reserve3 is wrong`,
    );
    expect(actualPaymentCashback.balance).to.equal(
      expectedPayment.cashbackAmount,
      `CashbackController.paymentCashbacks[${paymentIndex}].balance is wrong`,
    );
    expect(actualOnChainPayment.refundAmount).to.equal(
      expectedPayment.refundAmount,
      `payment[${paymentIndex}].refundAmount is wrong`,
    );
  }

  async #checkTokenBalances() {
    expect(await this.tokenMock.balanceOf(getAddress(this.cardPaymentProcessorShell.contract))).to.equal(
      this.cardPaymentProcessorShell.model.totalBalance,
      `The card payment processor token balance is wrong`,
    );

    expect(await this.tokenMock.balanceOf(this.cashOutAccount.address)).to.equal(
      this.cardPaymentProcessorShell.model.totalConfirmedAmount,
      `The cash-out account token balance is wrong`,
    );

    expect((await this.cardPaymentProcessorShell.contract.getPaymentStatistics()).totalUnconfirmedRemainder).to.equal(
      this.cardPaymentProcessorShell.model.totalUnconfirmedRemainder,
      `The total unconfirmed remainder is wrong`,
    );
  }

  #getBalanceChangePerAccount(operations: PaymentOperation[]) {
    const result = new Map<HardhatEthersSigner, number>();
    operations.forEach((operation) => {
      let balanceChange: number = result.get(operation.payer) ?? 0;
      balanceChange += operation.payerBalanceChange;
      result.set(operation.payer, balanceChange);

      const sponsor = operation.sponsor;
      if (sponsor) {
        balanceChange = result.get(sponsor) ?? 0;
        balanceChange += operation.sponsorBalanceChange;
        result.set(sponsor, balanceChange);
      }
    });
    return result;
  }
}

describe("Contract 'CardPaymentProcessor' with CashbackController hook connected", () => {
  const PAYMENT_ID_LENGTH_IN_BYTES = 32;
  const ZERO_PAYMENT_ID: string = ethers.toBeHex(0, PAYMENT_ID_LENGTH_IN_BYTES);
  const CASHBACK_RATE_MAX = 500; // 50%
  const CASHBACK_RATE_DEFAULT = 100; // 10%
  const CASHBACK_RATE_ZERO = 0;
  const EXPECTED_VERSION: Version = {
    major: 2,
    minor: 4,
    patch: 1,
  };

  // Errors of the library contracts
  const ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";
  const ERROR_NAME_ENFORCED_PAUSE = "EnforcedPause";
  const ERROR_NAME_ERC20_INSUFFICIENT_BALANCE = "ERC20InsufficientBalance";
  const ERROR_NAME_INVALID_INITIALIZATION = "InvalidInitialization";

  // Errors of the contract under test
  const ERROR_NAME_ACCOUNT_ZERO_ADDRESS = "AccountZeroAddress";
  const ERROR_NAME_CASHBACK_RATE_EXCESS = "CashbackRateExcess";
  const ERROR_NAME_DEFAULT_CASHBACK_RATE_UNCHANGED = "DefaultCashbackRateUnchanged";
  const ERROR_NAME_CASH_OUT_ACCOUNT_UNCHANGED = "CashOutAccountUnchanged";
  const ERROR_NAME_CASH_OUT_ACCOUNT_ZERO_ADDRESS = "CashOutAccountZeroAddress";
  const ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID = "ImplementationAddressInvalid";
  const ERROR_NAME_INAPPROPRIATE_CONFIRMATION_AMOUNT = "InappropriateConfirmationAmount";
  const ERROR_NAME_INAPPROPRIATE_REFUNDING_AMOUNT = "InappropriateRefundingAmount";
  const ERROR_NAME_INAPPROPRIATE_PAYMENT_STATUS = "InappropriatePaymentStatus";
  const ERROR_NAME_INAPPROPRIATE_SUM_AMOUNT = "InappropriateSumAmount";
  const ERROR_NAME_OVERFLOW_OF_SUBSIDY_LIMIT = "OverflowOfSubsidyLimit";
  const ERROR_NAME_OVERFLOW_OF_SUM_AMOUNT = "OverflowOfSumAmount";
  const ERROR_NAME_PAYER_ZERO_ADDRESS = "PayerZeroAddress";
  const ERROR_NAME_PAYMENT_ALREADY_EXISTENT = "PaymentAlreadyExistent";
  const ERROR_NAME_PAYMENT_CONFIRMATION_ARRAY_EMPTY = "PaymentConfirmationArrayEmpty";
  const ERROR_NAME_PAYMENT_NON_EXISTENT = "PaymentNonExistent";
  const ERROR_NAME_PAYMENT_ZERO_ID = "PaymentZeroId";
  const ERROR_NAME_SPONSOR_ZERO_ADDRESS = "SponsorZeroAddress";
  const ERROR_NAME_TOKEN_ZERO_ADDRESS = "TokenZeroAddress";

  const OWNER_ROLE: string = ethers.id("OWNER_ROLE");
  const GRANTOR_ROLE: string = ethers.id("GRANTOR_ROLE");
  const PAUSER_ROLE: string = ethers.id("PAUSER_ROLE");
  const RESCUER_ROLE: string = ethers.id("RESCUER_ROLE");
  const EXECUTOR_ROLE: string = ethers.id("EXECUTOR_ROLE");
  const HOOK_TRIGGER_ROLE: string = ethers.id("HOOK_TRIGGER_ROLE");
  const CASHBACK_OPERATOR_ROLE: string = ethers.id("CASHBACK_OPERATOR_ROLE");
  const MANAGER_ROLE: string = ethers.id("MANAGER_ROLE");

  let cardPaymentProcessorFactory: ContractFactory;
  let tokenMockFactory: ContractFactory;
  let cashbackControllerFactory: ContractFactory;

  let deployer: HardhatEthersSigner;
  let cashOutAccount: HardhatEthersSigner;
  let cashbackTreasury: HardhatEthersSigner;
  let executor: HardhatEthersSigner;
  let sponsor: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  before(async () => {
    [deployer, cashOutAccount, cashbackTreasury, executor, sponsor, user1, user2] = await ethers.getSigners();

    // Contract factories with the explicitly specified deployer account
    cardPaymentProcessorFactory = await ethers.getContractFactory("CardPaymentProcessor");
    cardPaymentProcessorFactory = cardPaymentProcessorFactory.connect(deployer);
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);
    cashbackControllerFactory = await ethers.getContractFactory("CashbackController");
    cashbackControllerFactory = cashbackControllerFactory.connect(deployer);
  });

  async function deployTokenMock(): Promise<{ tokenMock: Contract }> {
    const name = "ERC20 Test";
    const symbol = "TEST";

    let tokenMock = await tokenMockFactory.deploy(name, symbol) as Contract;
    await tokenMock.waitForDeployment();
    tokenMock = connect(tokenMock, deployer); // Explicitly specifying the initial account

    return { tokenMock };
  }

  async function deployTokenMockAndCardPaymentProcessor(): Promise<{
    cardPaymentProcessor: Contract;
    tokenMock: Contract;
  }> {
    const { tokenMock } = await deployTokenMock();

    let cardPaymentProcessor =
      await upgrades.deployProxy(
        cardPaymentProcessorFactory,
        [getAddress(tokenMock), cashOutAccount.address],
      ) as Contract;
    await cardPaymentProcessor.waitForDeployment();
    cardPaymentProcessor = connect(cardPaymentProcessor, deployer); // Explicitly specifying the initial account

    return {
      cardPaymentProcessor,
      tokenMock,
    };
  }

  async function deployCashbackController(tokenMock: Contract): Promise<Contract> {
    let cashbackController =
      await upgrades.deployProxy(cashbackControllerFactory, [getAddress(tokenMock)]) as Contract;
    await cashbackController.waitForDeployment();
    cashbackController = connect(cashbackController, deployer); // Explicitly specifying the initial account

    return cashbackController;
  }

  async function deployAndConfigureAllContracts(): Promise<Fixture> {
    const { cardPaymentProcessor, tokenMock } = await deployTokenMockAndCardPaymentProcessor();
    const cashbackController = await deployCashbackController(tokenMock);

    await proveTx(cashbackController.grantRole(GRANTOR_ROLE, deployer.address));
    await proveTx(cardPaymentProcessor.grantRole(GRANTOR_ROLE, deployer.address));
    await proveTx(cardPaymentProcessor.grantRole(PAUSER_ROLE, deployer.address));
    await proveTx(cardPaymentProcessor.grantRole(EXECUTOR_ROLE, executor.address));

    await proveTx(connect(tokenMock, cashbackTreasury).approve(getAddress(cashbackController), MAX_UINT256));
    await proveTx(cashbackController.setCashbackTreasury(cashbackTreasury.address));
    await proveTx(cardPaymentProcessor.setDefaultCashbackRate(CASHBACK_RATE_DEFAULT));

    await proveTx(connect(tokenMock, cashOutAccount).approve(getAddress(cardPaymentProcessor), MAX_UINT256));

    await proveTx(tokenMock.mint(cashbackTreasury.address, MAX_INT256));
    await proveTx(tokenMock.mint(sponsor.address, INITIAL_SPONSOR_BALANCE));
    await proveTx(connect(tokenMock, sponsor).approve(getAddress(cardPaymentProcessor), MAX_UINT256));

    await proveTx(cashbackController.grantRole(HOOK_TRIGGER_ROLE, getAddress(cardPaymentProcessor)));
    await proveTx(cardPaymentProcessor.registerHook(getAddress(cashbackController)));

    return {
      cashbackController,
      cardPaymentProcessor,
      tokenMock,
    };
  }

  async function pauseContract(contract: Contract) {
    if (!(await contract.hasRole(PAUSER_ROLE, deployer.address))) {
      await proveTx(contract.grantRole(GRANTOR_ROLE, deployer.address));
      await proveTx(contract.grantRole(PAUSER_ROLE, deployer.address));
    }
    await proveTx(contract.pause());
  }

  function createTestPayments(numberOfPayments = 1): TestPayment[] {
    const testPayments: TestPayment[] = [];
    for (let i = 0; i < numberOfPayments; ++i) {
      const payment: TestPayment = {
        id: ethers.toBeHex(i + 1, PAYMENT_ID_LENGTH_IN_BYTES),
        payer: (i % 2 > 0) ? user1 : user2,
        baseAmount: Math.floor(123.456789 * DIGITS_COEF + i * 123.456789 * DIGITS_COEF),
        extraAmount: Math.floor(132.456789 * DIGITS_COEF + i * 132.456789 * DIGITS_COEF),
      };
      expect(payment.baseAmount).greaterThan(10 * DIGITS_COEF);
      expect(payment.extraAmount).greaterThan(10 * DIGITS_COEF);
      testPayments.push(payment);
    }
    return testPayments;
  }

  async function prepareForPayments(props: { paymentNumber: number } = { paymentNumber: 1 }): Promise<TestContext> {
    const fixture: Fixture = await setUpFixture(deployAndConfigureAllContracts);
    const payments = createTestPayments(props.paymentNumber);
    return new TestContext({
      fixture,
      cashbackRateInPermil: CASHBACK_RATE_DEFAULT,
      cashbackEnabled: true,
      cashOutAccount,
      cashbackTreasury,
      cardPaymentProcessorExecutor: executor,
      payments,
    });
  }

  async function beforeMakingPayments(props: { paymentNumber: number } = { paymentNumber: 1 }): Promise<TestContext> {
    const context = await prepareForPayments(props);
    await context.setUpContractsForPayments();
    return context;
  }

  describe("Function 'initialize()'", () => {
    it("Configures the contract as expected", async () => {
      const { cardPaymentProcessor, tokenMock } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);

      // The underlying contract address
      expect(await cardPaymentProcessor.token()).to.equal(getAddress(tokenMock));

      // The role hashes
      expect(await cardPaymentProcessor.OWNER_ROLE()).to.equal(OWNER_ROLE);
      expect(await cardPaymentProcessor.GRANTOR_ROLE()).to.equal(GRANTOR_ROLE);
      expect(await cardPaymentProcessor.PAUSER_ROLE()).to.equal(PAUSER_ROLE);
      expect(await cardPaymentProcessor.RESCUER_ROLE()).to.equal(RESCUER_ROLE);
      expect(await cardPaymentProcessor.EXECUTOR_ROLE()).to.equal(EXECUTOR_ROLE);

      // The admins of roles
      expect(await cardPaymentProcessor.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE);
      expect(await cardPaymentProcessor.getRoleAdmin(GRANTOR_ROLE)).to.equal(OWNER_ROLE);
      expect(await cardPaymentProcessor.getRoleAdmin(PAUSER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await cardPaymentProcessor.getRoleAdmin(RESCUER_ROLE)).to.equal(GRANTOR_ROLE);
      expect(await cardPaymentProcessor.getRoleAdmin(EXECUTOR_ROLE)).to.equal(GRANTOR_ROLE);

      // The deployer should have the owner role, but not the other roles
      expect(await cardPaymentProcessor.hasRole(OWNER_ROLE, deployer.address)).to.equal(true);
      expect(await cardPaymentProcessor.hasRole(GRANTOR_ROLE, deployer.address)).to.equal(false);
      expect(await cardPaymentProcessor.hasRole(PAUSER_ROLE, deployer.address)).to.equal(false);
      expect(await cardPaymentProcessor.hasRole(RESCUER_ROLE, deployer.address)).to.equal(false);
      expect(await cardPaymentProcessor.hasRole(EXECUTOR_ROLE, deployer.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await cardPaymentProcessor.paused()).to.equal(false);

      // Cashback related values
      expect(await cardPaymentProcessor.defaultCashbackRate()).to.equal(0);
      expect(await cardPaymentProcessor.MAX_CASHBACK_RATE()).to.equal(CASHBACK_RATE_MAX);

      // The cash-out account
      expect(await cardPaymentProcessor.cashOutAccount()).to.equal(cashOutAccount.address);

      // Additional constrains
      expect(await cardPaymentProcessor.MAX_CASHBACK_RATE()).to.be.lessThanOrEqual(0xFFFF);
    });

    it("Is reverted if it is called a second time", async () => {
      const { cardPaymentProcessor, tokenMock } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);
      await expect(cardPaymentProcessor.initialize(getAddress(tokenMock), cashOutAccount.address))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_INVALID_INITIALIZATION);
    });

    it("Is reverted if the passed token address is zero", async () => {
      const anotherCardPaymentProcessor =
        await upgrades.deployProxy(cardPaymentProcessorFactory, [], { initializer: false }) as Contract;

      await expect(anotherCardPaymentProcessor.initialize(ZERO_ADDRESS, cashOutAccount.address))
        .to.be.revertedWithCustomError(anotherCardPaymentProcessor, ERROR_NAME_TOKEN_ZERO_ADDRESS);
    });

    it("Is reverted for the contract implementation if it is called even for the first time", async () => {
      const tokenAddress = user1.address;
      const cashierImplementation = await cardPaymentProcessorFactory.deploy() as Contract;
      await cashierImplementation.waitForDeployment();

      await expect(cashierImplementation.initialize(tokenAddress, cashOutAccount.address))
        .to.be.revertedWithCustomError(cashierImplementation, ERROR_NAME_INVALID_INITIALIZATION);
    });

    it("Is reverted if the passed cash-out account address is zero", async () => {
      const tokenAddress = user1.address;
      const anotherCardPaymentProcessor =
        await upgrades.deployProxy(cardPaymentProcessorFactory, [], { initializer: false }) as Contract;

      await expect(anotherCardPaymentProcessor.initialize(tokenAddress, ZERO_ADDRESS))
        .to.be.revertedWithCustomError(anotherCardPaymentProcessor, ERROR_NAME_CASH_OUT_ACCOUNT_ZERO_ADDRESS);
    });
  });

  describe("Function '$__VERSION()'", () => {
    it("Returns expected values", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);
      const cardPaymentProcessorVersion = await cardPaymentProcessor.$__VERSION();
      checkEquality(cardPaymentProcessorVersion, EXPECTED_VERSION);
    });
  });

  describe("Function 'upgradeToAndCall()'", () => {
    it("Executes as expected", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);
      await checkContractUupsUpgrading(cardPaymentProcessor, cardPaymentProcessorFactory);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);

      await expect(connect(cardPaymentProcessor, user1).upgradeToAndCall(cardPaymentProcessor, "0x"))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT);
    });

    it("Is reverted if the provided implementation address is not a card payment processor contract", async () => {
      const { cardPaymentProcessor, tokenMock } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);

      await expect(cardPaymentProcessor.upgradeToAndCall(getAddress(tokenMock), "0x"))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
    });
  });

  describe("Function 'upgradeTo()'", () => {
    it("Executes as expected", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);
      await checkContractUupsUpgrading(cardPaymentProcessor, cardPaymentProcessorFactory, "upgradeTo(address)");
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);

      await expect(connect(cardPaymentProcessor, user1).upgradeTo(cardPaymentProcessor))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT);
    });

    it("Is reverted if the provided implementation address is not a card payment processor contract", async () => {
      const { cardPaymentProcessor, tokenMock } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);

      await expect(cardPaymentProcessor.upgradeTo(getAddress(tokenMock)))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_IMPLEMENTATION_ADDRESS_INVALID);
    });
  });

  describe("Function 'setCashOutAccount()'", () => {
    it("Executes as expected and emits the correct event", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);
      const newCashOutAccount = user1.address;
      const oldCashOutAccount = await cardPaymentProcessor.cashOutAccount();

      await expect(cardPaymentProcessor.setCashOutAccount(newCashOutAccount))
        .to.emit(cardPaymentProcessor, EVENT_NAME_CASH_OUT_ACCOUNT_CHANGED)
        .withArgs(oldCashOutAccount, newCashOutAccount);

      expect(await cardPaymentProcessor.cashOutAccount()).to.equal(newCashOutAccount);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);
      const newCashOutAccount = user1.address;

      await expect(connect(cardPaymentProcessor, user1).setCashOutAccount(newCashOutAccount))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(user1.address, OWNER_ROLE);
    });

    it("Is reverted if the new cash-out account is the same as the previous set one", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);

      await expect(cardPaymentProcessor.setCashOutAccount(cashOutAccount.address))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_CASH_OUT_ACCOUNT_UNCHANGED);
    });

    it("Is reverted if the new cash-out account is the zero address", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);
      await expect(cardPaymentProcessor.setCashOutAccount(ZERO_ADDRESS))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_CASH_OUT_ACCOUNT_ZERO_ADDRESS);
    });
  });

  describe("Function 'setDefaultCashbackRate()'", () => {
    it("Executes as expected and emits the correct event", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);

      await expect(cardPaymentProcessor.setDefaultCashbackRate(CASHBACK_RATE_DEFAULT))
        .to.emit(cardPaymentProcessor, EVENT_NAME_DEFAULT_CASHBACK_RATE_CHANGED)
        .withArgs(CASHBACK_RATE_ZERO, CASHBACK_RATE_DEFAULT);

      expect(await cardPaymentProcessor.defaultCashbackRate()).to.equal(CASHBACK_RATE_DEFAULT);

      await expect(cardPaymentProcessor.setDefaultCashbackRate(CASHBACK_RATE_ZERO))
        .to.emit(cardPaymentProcessor, EVENT_NAME_DEFAULT_CASHBACK_RATE_CHANGED)
        .withArgs(CASHBACK_RATE_DEFAULT, CASHBACK_RATE_ZERO);

      expect(await cardPaymentProcessor.defaultCashbackRate()).to.equal(CASHBACK_RATE_ZERO);
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);
      await expect(connect(cardPaymentProcessor, user1).setDefaultCashbackRate(CASHBACK_RATE_DEFAULT))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT)
        .withArgs(user1.address, OWNER_ROLE);
    });

    it("Is reverted if the new rate exceeds the allowable maximum", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);
      await expect(cardPaymentProcessor.setDefaultCashbackRate(CASHBACK_RATE_MAX + 1))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_CASHBACK_RATE_EXCESS);
    });

    it("Is reverted if called with the same argument twice", async () => {
      const { cardPaymentProcessor } = await setUpFixture(deployTokenMockAndCardPaymentProcessor);
      await proveTx(cardPaymentProcessor.setDefaultCashbackRate(CASHBACK_RATE_DEFAULT));

      await expect(cardPaymentProcessor.setDefaultCashbackRate(CASHBACK_RATE_DEFAULT))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_DEFAULT_CASHBACK_RATE_UNCHANGED);
    });
  });

  describe("Function 'makePaymentFor()'", () => {
    async function checkPaymentMakingFor(
      context: TestContext,
      props: {
        sponsor?: HardhatEthersSigner;
        subsidyLimit?: number;
        cashbackEnabled?: boolean;
        cashbackRate?: number;
        confirmationAmount?: number;
      } = {},
    ) {
      const { cardPaymentProcessorShell, payments: [payment] } = context;
      const cashbackEnabled = typeof props.cashbackEnabled !== "undefined" ? props.cashbackEnabled : true;
      cardPaymentProcessorShell.model.makePayment(
        payment,
        {
          sponsor: props.sponsor,
          subsidyLimit: props.subsidyLimit,
          cashbackRate: cashbackEnabled ? props.cashbackRate : 0,
          confirmationAmount: props.confirmationAmount,
          sender: executor,
        },
      );
      const tx = (cardPaymentProcessorShell.contract.connect(executor) as Contract).makePaymentFor(
        payment.id,
        payment.payer.address,
        payment.baseAmount,
        payment.extraAmount,
        props.sponsor?.address ?? ZERO_SPONSOR_ADDRESS,
        props.subsidyLimit ?? ZERO_SUBSIDY_LIMIT,
        cashbackEnabled ? (props.cashbackRate ?? CASHBACK_RATE_AS_IN_CONTRACT) : CASHBACK_RATE_ZERO,
        props.confirmationAmount ?? ZERO_CONFIRMATION_AMOUNT,
      );
      await context.checkPaymentOperationsForTx(tx);
      await context.checkCardPaymentProcessorState();
    }

    describe("Executes as expected if", () => {
      describe("The payment is not immediately confirmed, and", () => {
        describe("The payment is not sponsored, and", () => {
          describe("The cashback rate is determined by the contract settings, and", () => {
            describe("Cashback is enabled, and the base and extra payment amounts are", () => {
              it("Both nonzero", async () => {
                const context = await beforeMakingPayments();
                await checkPaymentMakingFor(context);
              });

              it("Both nonzero, and if the subsidy limit argument is zero", async () => {
                const context = await beforeMakingPayments();
                await checkPaymentMakingFor(context);
              });

              it("Both zero", async () => {
                const context = await beforeMakingPayments();
                context.payments[0].baseAmount = 0;
                context.payments[0].extraAmount = 0;
                await checkPaymentMakingFor(context);
              });

              it("Different: base is zero, extra is nonzero", async () => {
                const context = await beforeMakingPayments();
                context.payments[0].baseAmount = 0;
                await checkPaymentMakingFor(context);
              });

              it("Different: base is nonzero, extra is zero", async () => {
                const context = await beforeMakingPayments();
                context.payments[0].extraAmount = 0;
                await checkPaymentMakingFor(context);
              });

              it("Both nonzero, and cashback is partially sent with a non-zero amount", async () => {
                const context = await beforeMakingPayments();
                const { payments: [payment], cardPaymentProcessorShell } = context;
                const sentCashbackAmount = 2 * CASHBACK_ROUNDING_COEF;
                const presetCashbackAmount = MAX_CASHBACK_FOR_CAP_PERIOD - sentCashbackAmount;
                await context.presetCashbackForAccount(payment.payer, presetCashbackAmount);
                cardPaymentProcessorShell.model.setCashbackSendingAmountResult(sentCashbackAmount);
                await checkPaymentMakingFor(context);
              });
            });

            describe("Cashback is disabled, and the base and extra payment amounts are", () => {
              it("Both nonzero", async () => {
                const context = await beforeMakingPayments();
                await checkPaymentMakingFor(context, { cashbackEnabled: false });
              });
            });

            describe("Cashback is enabled, and the base and extra payment amounts are nonzero, and", () => {
              it("The treasury has insufficient balance", async () => {
                const context = await beforeMakingPayments();
                const { cardPaymentProcessorShell, tokenMock } = context;
                await proveTx(connect(tokenMock, cashbackTreasury)
                  .transfer(
                    sponsor.address,
                    await tokenMock.balanceOf(cashbackTreasury.address) - BigInt(CASHBACK_ROUNDING_COEF),
                  ),
                );
                cardPaymentProcessorShell.model.setCashbackSendingStatus(CashbackOperationStatus.OutOfFunds);
                await checkPaymentMakingFor(context);
              });

              it("The cashback is capped", async () => {
                const context = await beforeMakingPayments();
                const { payments: [payment] } = context;
                await context.presetCashbackForAccount(payment.payer, MAX_CASHBACK_FOR_CAP_PERIOD);
                await checkPaymentMakingFor(context);
              });
            });
          });
        });

        describe("The payment is sponsored, cashback is enabled, and", () => {
          describe("The cashback rate is determined by the contract settings, and", () => {
            describe("The base and extra payment amounts are both nonzero, and the subsidy limit is", () => {
              it("Zero", async () => {
                const context = await beforeMakingPayments();
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit: 0 });
              });

              it("Less than the base amount", async () => {
                const context = await beforeMakingPayments();
                const subsidyLimit = Math.floor(context.payments[0].baseAmount / 2);
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit });
              });

              it("Less than the payment sum amount but higher than the base amount", async () => {
                const context = await beforeMakingPayments();
                const { payments: [payment] } = context;
                const subsidyLimit = payment.baseAmount + Math.floor(payment.extraAmount / 2);
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit });
              });

              it("The same as the payment sum amount", async () => {
                const context = await beforeMakingPayments();
                const { payments: [payment] } = context;
                const subsidyLimit = payment.baseAmount + payment.extraAmount;
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit });
              });

              it("Greater than the payment sum amount", async () => {
                const context = await beforeMakingPayments();
                const { payments: [payment] } = context;
                const sumAmount = payment.baseAmount + payment.extraAmount;
                const subsidyLimit = Math.floor(sumAmount * 1.1);
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit });
              });
            });

            describe("The base and extra payment amounts are both zero, and the subsidy limit is", () => {
              it("Non-zero", async () => {
                const context = await beforeMakingPayments();
                const { payments: [payment] } = context;
                const subsidyLimit = payment.baseAmount;
                payment.baseAmount = 0;
                payment.extraAmount = 0;
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit });
              });

              it("Zero", async () => {
                const context = await beforeMakingPayments();
                const { payments: [payment] } = context;
                payment.baseAmount = 0;
                payment.extraAmount = 0;
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit: 0 });
              });
            });

            describe("The base amount is nonzero, the extra amount is zero, and the subsidy limit is", () => {
              it("The same as the payment sum amount", async () => {
                const context = await beforeMakingPayments();
                context.payments[0].extraAmount = 0;
                const subsidyLimit = context.payments[0].baseAmount;
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit });
              });

              it("Less than the payment sum amount", async () => {
                const context = await beforeMakingPayments();
                context.payments[0].extraAmount = 0;
                const subsidyLimit = Math.floor(context.payments[0].baseAmount / 2);
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit });
              });

              it("Zero", async () => {
                const context = await beforeMakingPayments();
                context.payments[0].extraAmount = 0;
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit: 0 });
              });
            });

            describe("The base amount is zero, the extra amount is nonzero, and the subsidy limit is", () => {
              it("The same as the payment sum amount", async () => {
                const context = await beforeMakingPayments();
                context.payments[0].baseAmount = 0;
                const subsidyLimit = context.payments[0].extraAmount;
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit });
              });

              it("Less than the payment sum amount", async () => {
                const context = await beforeMakingPayments();
                context.payments[0].baseAmount = 0;
                const subsidyLimit = Math.floor(context.payments[0].extraAmount / 2);
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit });
              });

              it("Zero", async () => {
                const context = await beforeMakingPayments();
                context.payments[0].baseAmount = 0;
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit: 0 });
              });
            });
          });

          describe("The cashback rate is requested to be zero, and", () => {
            const cashbackRate = 0;
            describe("The base and extra payment amounts are both nonzero, and the subsidy limit is ", () => {
              it("Less than the base amount", async () => {
                const context = await beforeMakingPayments();
                const subsidyLimit = Math.floor(context.payments[0].baseAmount / 2);
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit, cashbackRate });
              });
            });
          });

          describe("The cashback is requested to be a special value, and", () => {
            const cashbackRate = CASHBACK_RATE_DEFAULT * 2;
            describe("The base and extra payment amounts are both nonzero, and the subsidy limit is ", () => {
              it("Less than the base amount", async () => {
                const context = await beforeMakingPayments();
                const subsidyLimit = Math.floor(context.payments[0].baseAmount / 2);
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit, cashbackRate });
              });

              it("Zero", async () => {
                const context = await beforeMakingPayments();
                await checkPaymentMakingFor(context, { sponsor, subsidyLimit: 0, cashbackRate });
              });
            });
          });
        });
      });

      describe("The payment is immediately confirmed, sponsored, with some amounts, usual cashback, and", () => {
        describe("The confirmation amount is", () => {
          it("Less than the base amount", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount / 2);
            const confirmationAmount = Math.floor(payment.baseAmount / 4);
            await checkPaymentMakingFor(context, { sponsor, subsidyLimit, confirmationAmount });
          });

          it("Less than the payment sum amount but higher than the base amount", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount / 2);
            const confirmationAmount = payment.baseAmount + Math.floor(payment.extraAmount / 2);
            await checkPaymentMakingFor(context, { sponsor, subsidyLimit, confirmationAmount });
          });

          it("The same as the payment sum amount", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount / 2);
            const confirmationAmount = payment.baseAmount + payment.extraAmount;
            await checkPaymentMakingFor(context, { sponsor, subsidyLimit, confirmationAmount });
          });
        });
      });
    });

    describe("Is reverted if", () => {
      const subsidyLimit = INITIAL_SPONSOR_BALANCE;

      it("The contract is paused", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await pauseContract(cardPaymentProcessorShell.contract);

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makePaymentFor(
            payment.id,
            payment.payer.address,
            payment.baseAmount,
            payment.extraAmount,
            sponsor.address,
            subsidyLimit,
            CASHBACK_RATE_AS_IN_CONTRACT,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("The caller does not have the executor role", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, payment.payer).makePaymentFor(
            payment.id,
            payment.payer.address,
            payment.baseAmount,
            payment.extraAmount,
            sponsor.address,
            subsidyLimit,
            CASHBACK_RATE_AS_IN_CONTRACT,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
        ).withArgs(payment.payer.address, EXECUTOR_ROLE);
      });

      it("The payer address is zero", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makePaymentFor(
            payment.id,
            ZERO_PAYER_ADDRESS,
            payment.baseAmount,
            payment.extraAmount,
            sponsor.address,
            subsidyLimit,
            CASHBACK_RATE_AS_IN_CONTRACT,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_PAYER_ZERO_ADDRESS);
      });

      it("The payment ID is zero", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makePaymentFor(
            ZERO_PAYMENT_ID,
            payment.payer.address,
            payment.baseAmount,
            payment.extraAmount,
            sponsor.address,
            subsidyLimit,
            CASHBACK_RATE_AS_IN_CONTRACT,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_PAYMENT_ZERO_ID);
      });

      it("The account does not have enough token balance", async () => {
        const context = await beforeMakingPayments();
        const { cardPaymentProcessorShell, tokenMock, payments: [payment] } = context;

        payment.baseAmount = INITIAL_USER_BALANCE + 1;
        payment.extraAmount = 0;
        const subsidyLimitLocal = 0;
        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makePaymentFor(
            payment.id,
            payment.payer.address,
            payment.baseAmount,
            payment.extraAmount,
            sponsor.address,
            subsidyLimitLocal,
            CASHBACK_RATE_AS_IN_CONTRACT,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(
          tokenMock,
          ERROR_NAME_ERC20_INSUFFICIENT_BALANCE,
        ).withArgs(payment.payer.address, anyValue, anyValue);
      });

      it("The sponsor does not have enough token balance", async () => {
        const context = await beforeMakingPayments();
        const { cardPaymentProcessorShell, tokenMock, payments: [payment] } = context;

        const subsidyLimitLocal = INITIAL_SPONSOR_BALANCE + 1;
        payment.baseAmount = 0;
        payment.extraAmount = subsidyLimitLocal;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makePaymentFor(
            payment.id,
            payment.payer.address,
            payment.baseAmount,
            payment.extraAmount,
            sponsor.address,
            subsidyLimitLocal,
            CASHBACK_RATE_AS_IN_CONTRACT,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(
          tokenMock,
          ERROR_NAME_ERC20_INSUFFICIENT_BALANCE,
        ).withArgs(sponsor.address, anyValue, anyValue);
      });

      it("The payment with the provided ID already exists", async () => {
        const context = await beforeMakingPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await cardPaymentProcessorShell.makeCommonPayments([payment]);

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makePaymentFor(
            payment.id,
            payment.payer.address,
            payment.baseAmount,
            payment.extraAmount,
            sponsor.address,
            subsidyLimit,
            CASHBACK_RATE_AS_IN_CONTRACT,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_PAYMENT_ALREADY_EXISTENT);
      });

      it("The requested cashback rate exceeds the maximum allowed value", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makePaymentFor(
            payment.id,
            payment.payer.address,
            payment.baseAmount,
            payment.extraAmount,
            sponsor.address,
            subsidyLimit,
            CASHBACK_RATE_MAX + 1,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_CASHBACK_RATE_EXCESS);
      });

      it("The payment sum amount is greater than 64-bit unsigned integer", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;
        const paymentBaseAmount = MAX_UINT64;
        const paymentExtraAmount = 1n;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makePaymentFor(
            payment.id,
            payment.payer.address,
            paymentBaseAmount,
            paymentExtraAmount,
            sponsor.address,
            subsidyLimit,
            CASHBACK_RATE_AS_IN_CONTRACT,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_OVERFLOW_OF_SUM_AMOUNT);
      });

      it("The payment subsidy limit is not zero, but the sponsor address is zero", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makePaymentFor(
            payment.id,
            payment.payer.address,
            payment.baseAmount,
            payment.extraAmount,
            ZERO_SPONSOR_ADDRESS,
            subsidyLimit,
            CASHBACK_RATE_AS_IN_CONTRACT,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_SPONSOR_ZERO_ADDRESS);
      });

      it("The payment subsidy limit is greater than 64-bit unsigned integer", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;
        const subsidyLimitOverflowed = MAX_UINT64 + 1n;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makePaymentFor(
            payment.id,
            payment.payer.address,
            payment.baseAmount,
            payment.extraAmount,
            sponsor.address,
            subsidyLimitOverflowed,
            CASHBACK_RATE_AS_IN_CONTRACT,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_OVERFLOW_OF_SUBSIDY_LIMIT);
      });

      it("The confirmation amount for the payment is greater than the sum amount", async () => {
        const context = await beforeMakingPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        const excessConfirmationAmount = payment.baseAmount + payment.extraAmount + 1;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makePaymentFor(
            payment.id,
            payment.payer.address,
            payment.baseAmount,
            payment.extraAmount,
            sponsor.address,
            subsidyLimit,
            CASHBACK_RATE_AS_IN_CONTRACT,
            excessConfirmationAmount,
          ),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_INAPPROPRIATE_CONFIRMATION_AMOUNT,
        );
      });
    });
  });

  describe("Function 'makeCommonPaymentFor()'", () => {
    /* Since the function under test uses the same common internal function to make a payment,
     * the complete set of checks are provided in the test section for the 'makePaymentFor()' function.
     * In this section, only specific checks are provided.
     */
    describe("Executes as expected if", () => {
      it("Cashback is enabled, and the base and extra payment amounts are both nonzero", async () => {
        const context = await beforeMakingPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;
        cardPaymentProcessorShell.model.makePayment(payment, { sender: executor });

        const tx = (cardPaymentProcessorShell.contract.connect(executor) as Contract).makeCommonPaymentFor(
          payment.id,
          payment.payer.address,
          payment.baseAmount,
          payment.extraAmount,
        );
        await context.checkPaymentOperationsForTx(tx);
        await context.checkCardPaymentProcessorState();
      });
    });

    describe("Is reverted if", () => {
      it("The contract is paused", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await pauseContract(cardPaymentProcessorShell.contract);

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makeCommonPaymentFor(
            payment.id,
            payment.payer.address,
            payment.baseAmount,
            payment.extraAmount,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("The caller does not have the executor role", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, payment.payer).makeCommonPaymentFor(
            payment.id,
            payment.payer.address,
            payment.baseAmount,
            payment.extraAmount,
          ),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
        ).withArgs(payment.payer.address, EXECUTOR_ROLE);
      });

      it("The payer address is zero", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).makeCommonPaymentFor(
            payment.id,
            ZERO_PAYER_ADDRESS,
            payment.baseAmount,
            payment.extraAmount,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_PAYER_ZERO_ADDRESS);
      });
    });
  });

  describe("Function 'updatePayment()'", () => {
    async function checkUpdating(
      context: TestContext,
      props: {
        cashbackCondition?: CashbackConditionType;
        newBaseAmount?: number;
        newExtraAmount?: number;
        refundAmount?: number;
        confirmedAmount?: number;
        subsidyLimit?: number;
      } = { cashbackCondition: CashbackConditionType.CashbackEnabled },
    ) {
      const { cardPaymentProcessorShell, tokenMock, payments: [payment] } = context;
      const { cashbackCondition, subsidyLimit, confirmedAmount: confirmedAmount } = props;
      const newBaseAmount = props.newBaseAmount ?? payment.baseAmount;
      const newExtraAmount = props.newExtraAmount ?? payment.extraAmount;

      if (cashbackCondition === CashbackConditionType.CashbackDisabledBeforePaymentMaking) {
        await cardPaymentProcessorShell.disableCashback();
      }

      await cardPaymentProcessorShell.makePaymentFor(
        payment,
        { sponsor, subsidyLimit, confirmationAmount: confirmedAmount },
      );

      if (cashbackCondition === CashbackConditionType.CashbackDisabledAfterPaymentMaking) {
        await cardPaymentProcessorShell.disableCashback();
      }

      if (props.refundAmount === 0 || props.refundAmount) {
        await cardPaymentProcessorShell.refundPayment(payment, props.refundAmount ?? 0);
      } else {
        const refundAmount = Math.floor(payment.baseAmount * 0.1);
        await cardPaymentProcessorShell.refundPayment(payment, refundAmount);
      }
      if (cashbackCondition === CashbackConditionType.CashbackEnabledButIncreasingPartial) {
        const actualCashbackChange = 2 * CASHBACK_ROUNDING_COEF;
        const presetCashbackAmount = MAX_CASHBACK_FOR_CAP_PERIOD - actualCashbackChange;
        await context.presetCashbackForAccount(payment.payer, presetCashbackAmount);
        cardPaymentProcessorShell.model.setCashbackIncreaseAmountResult(actualCashbackChange);
      }
      if (
        cashbackCondition === CashbackConditionType.CashbackEnabledButTreasuryHasInsufficientBalance
      ) {
        cardPaymentProcessorShell.model.setCashbackIncreaseStatus(CashbackOperationStatus.OutOfFunds);
      }

      await context.checkCardPaymentProcessorState();

      cardPaymentProcessorShell.model.updatePayment(
        payment.id,
        newBaseAmount,
        newExtraAmount,
      );
      if (
        cashbackCondition === CashbackConditionType.CashbackEnabledButTreasuryHasInsufficientBalance
      ) {
        await proveTx(connect(tokenMock, cashbackTreasury)
          .transfer(
            sponsor.address,
            await tokenMock.balanceOf(cashbackTreasury.address) - BigInt(CASHBACK_ROUNDING_COEF),
          ));
      }

      const tx = (cardPaymentProcessorShell.contract.connect(executor) as Contract).updatePayment(
        payment.id,
        newBaseAmount,
        newExtraAmount,
      );

      await context.checkPaymentOperationsForTx(tx);
      await context.checkCardPaymentProcessorState();
    }

    describe("Executes as expected if", () => {
      describe("The payment is not subsidized and not confirmed, and", () => {
        describe("The base amount decreases, and", () => {
          describe("The extra amount remains the same, and cashback is", () => {
            it("Enabled, and cashback operation is executed successfully", async () => {
              const context = await beforeMakingPayments();
              const newBaseAmount = Math.floor(context.payments[0].baseAmount * 0.9);
              await checkUpdating(context, { newBaseAmount });
            });

            it("Disabled before payment making", async () => {
              const context = await beforeMakingPayments();
              const newBaseAmount = Math.floor(context.payments[0].baseAmount * 0.9);
              await checkUpdating(context, {
                newBaseAmount,
                cashbackCondition: CashbackConditionType.CashbackDisabledBeforePaymentMaking,
              });
            });

            it("Disabled after payment making", async () => {
              const context = await beforeMakingPayments();
              const newBaseAmount = Math.floor(context.payments[0].baseAmount * 0.9);
              await checkUpdating(context, {
                newBaseAmount,
                cashbackCondition: CashbackConditionType.CashbackDisabledAfterPaymentMaking,
              });
            });
          });

          describe("The extra amount decreases, and cashback is", () => {
            it("Enabled, and cashback operation is executed successfully", async () => {
              const context = await beforeMakingPayments();
              const { payments: [payment] } = context;
              const newBaseAmount = Math.floor(payment.baseAmount * 0.9);
              const newExtraAmount = Math.floor(payment.extraAmount * 0.5);
              await checkUpdating(context, { newBaseAmount, newExtraAmount });
            });
          });

          describe("The extra amount increases but the sum amount decreases, and cashback is", () => {
            it("Enabled, and cashback operation is executed successfully", async () => {
              const context = await beforeMakingPayments();
              const { payments: [payment] } = context;
              const newBaseAmount = Math.floor(payment.baseAmount * 0.7);
              const newExtraAmount = Math.floor(payment.extraAmount * 1.1);
              const oldSumAmount = payment.baseAmount + payment.extraAmount;
              const newSumAmount = newBaseAmount + newExtraAmount;
              expect(newSumAmount - oldSumAmount).to.be.lessThan(0);
              await checkUpdating(context, { newBaseAmount, newExtraAmount });
            });
          });

          describe("The extra amount increases and the sum amount increases, and cashback is", () => {
            it("Enabled, and cashback operation is executed successfully", async () => {
              const context = await beforeMakingPayments();
              const { payments: [payment] } = context;
              const newBaseAmount = Math.floor(payment.baseAmount * 0.7);
              const newExtraAmount = Math.floor(payment.extraAmount * 2);
              const oldSumAmount = payment.baseAmount + payment.extraAmount;
              const newSumAmount = newBaseAmount + newExtraAmount;
              expect(newSumAmount - oldSumAmount).to.be.greaterThan(0);
              await checkUpdating(context, { newBaseAmount, newExtraAmount });
            });
          });

          describe("The extra amount becomes zero, and cashback is", () => {
            it("Enabled, and cashback operation is executed successfully", async () => {
              const context = await beforeMakingPayments();
              const newBaseAmount = Math.floor(context.payments[0].baseAmount * 0.9);
              const newExtraAmount = 0;
              await checkUpdating(context, { newBaseAmount, newExtraAmount });
            });
          });
        });

        describe("The base amount remains the same, and cashback is enabled, and", () => {
          it("The extra amount remains the same", async () => {
            const context = await beforeMakingPayments();
            await checkUpdating(context);
          });

          it("The extra amount decreases", async () => {
            const context = await beforeMakingPayments();
            const newExtraAmount = Math.floor(context.payments[0].extraAmount * 0.5);
            await checkUpdating(context, { newExtraAmount });
          });

          it("The extra amount increases", async () => {
            const context = await beforeMakingPayments();
            const newExtraAmount = Math.floor(context.payments[0].extraAmount * 2);
            await checkUpdating(context, { newExtraAmount });
          });

          it("The extra amount becomes zero", async () => {
            const context = await beforeMakingPayments();
            const newExtraAmount = 0;
            await checkUpdating(context, { newExtraAmount });
          });
        });

        describe("The base amount increases, and", () => {
          describe("The extra amount remains the same, and cashback is", () => {
            it("Enabled, and cashback operation is executed successfully", async () => {
              const context = await beforeMakingPayments();
              const newBaseAmount = Math.floor(context.payments[0].baseAmount * 1.1);
              await checkUpdating(context, { newBaseAmount });
            });

            it("Disabled before payment making", async () => {
              const context = await beforeMakingPayments();
              const newBaseAmount = Math.floor(context.payments[0].baseAmount * 1.1);
              await checkUpdating(context, {
                newBaseAmount,
                cashbackCondition: CashbackConditionType.CashbackDisabledBeforePaymentMaking,
              });
            });

            it("Disabled after payment making", async () => {
              const context = await beforeMakingPayments();
              const newBaseAmount = Math.floor(context.payments[0].baseAmount * 1.1);
              await checkUpdating(context, {
                newBaseAmount,
                cashbackCondition: CashbackConditionType.CashbackDisabledAfterPaymentMaking,
              });
            });

            it("Enabled but treasury has insufficient balance", async () => {
              const context = await beforeMakingPayments();
              const newBaseAmount = Math.floor(context.payments[0].baseAmount * 1.1);
              await checkUpdating(context, {
                newBaseAmount,
                cashbackCondition: CashbackConditionType.CashbackEnabledButTreasuryHasInsufficientBalance,
              });
            });

            it("Enabled but cashback operation executes partially", async () => {
              const context = await beforeMakingPayments();
              const newBaseAmount = Math.floor(context.payments[0].baseAmount * 1.1);
              await checkUpdating(context, {
                newBaseAmount,
                cashbackCondition: CashbackConditionType.CashbackEnabledButIncreasingPartial,
              });
            });
          });

          describe("The extra amount decreases and the sum amount decreases, and cashback is", () => {
            it("Enabled, and cashback operation is executed successfully", async () => {
              const context = await beforeMakingPayments();
              const { payments: [payment] } = context;
              const newBaseAmount = Math.floor(payment.baseAmount * 1.1);
              const newExtraAmount = Math.floor(payment.extraAmount * 0.5);
              const oldSumAmount = payment.baseAmount + payment.extraAmount;
              const newSumAmount = newBaseAmount + newExtraAmount;
              expect(newSumAmount - oldSumAmount).to.be.lessThan(0);
              await checkUpdating(context, { newBaseAmount, newExtraAmount });
            });
          });

          describe("The extra amount decreases but the sum amount increases, and cashback is", () => {
            it("Enabled, and cashback operation is executed successfully", async () => {
              const context = await beforeMakingPayments();
              const { payments: [payment] } = context;
              const newBaseAmount = Math.floor(payment.baseAmount * 1.5);
              const newExtraAmount = Math.floor(payment.extraAmount * 0.9);
              const oldSumAmount = payment.baseAmount + payment.extraAmount;
              const newSumAmount = newBaseAmount + newExtraAmount;
              expect(newSumAmount - oldSumAmount).to.be.greaterThan(0);
              await checkUpdating(context, { newBaseAmount, newExtraAmount });
            });
          });

          describe("The extra amount increases, and cashback is", () => {
            it("Enabled, and cashback operation is executed successfully", async () => {
              const context = await beforeMakingPayments();
              const newBaseAmount = Math.floor(context.payments[0].baseAmount * 1.1);
              const newExtraAmount = Math.floor(context.payments[0].extraAmount * 2);
              await checkUpdating(context, { newBaseAmount, newExtraAmount });
            });
          });

          describe("The extra amount becomes zero, and cashback is", () => {
            it("Enabled, and cashback operation is executed successfully", async () => {
              const context = await beforeMakingPayments();
              const newBaseAmount = Math.floor(context.payments[0].baseAmount * 0.9);
              const newExtraAmount = 0;
              await checkUpdating(context, { newBaseAmount, newExtraAmount });
            });
          });
        });

        describe("The base amount becomes zero, and cashback is enabled, and", () => {
          it("The extra amount remains the same", async () => {
            const context = await beforeMakingPayments();
            const newBaseAmount = 0;
            await checkUpdating(context, { newBaseAmount });
          });

          it("The extra amount decreases", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const newBaseAmount = 0;
            const newExtraAmount = Math.floor(payment.extraAmount * 0.5);
            await checkUpdating(context, { newBaseAmount, newExtraAmount });
          });

          it("The extra amount increases", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const newBaseAmount = 0;
            const newExtraAmount = Math.floor(payment.extraAmount * 2);
            await checkUpdating(context, { newBaseAmount, newExtraAmount });
          });

          it("The extra amount becomes zero", async () => {
            const context = await beforeMakingPayments();
            const newBaseAmount = 0;
            const newExtraAmount = 0;
            await checkUpdating(context, { newBaseAmount, newExtraAmount, refundAmount: 0 });
          });
        });
      });

      describe("The payment is subsidized but not confirmed, and", () => {
        describe("The initial subsidy limit (SL) is less than the base amount, and", () => {
          it("The base amount becomes zero, but the extra amount does not change", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
            const newBaseAmount = 0;
            await checkUpdating(context, { newBaseAmount, subsidyLimit });
          });

          it("The base and extra amounts both become zero", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
            const newBaseAmount = 0;
            const newExtraAmount = 0;
            await checkUpdating(context, { newBaseAmount, newExtraAmount, refundAmount: 0, subsidyLimit });
          });

          it("The base amount decreases but it is still above SL", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
            const newBaseAmount = Math.floor(payment.baseAmount * 0.9);
            await checkUpdating(context, { newBaseAmount, subsidyLimit });
          });

          it("The base amount decreases below SL but the sum amount is still above SL", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
            const newBaseAmount = Math.floor(payment.baseAmount * 0.3);
            expect(newBaseAmount + payment.extraAmount).to.be.greaterThan(subsidyLimit);
            await checkUpdating(context, { newBaseAmount, subsidyLimit });
          });

          it("The base amount decreases and the sum amount becomes below SL", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
            const newBaseAmount = Math.floor(payment.baseAmount * 0.2);
            const newExtraAmount = Math.floor(payment.extraAmount * 0.2);
            expect(newBaseAmount + newExtraAmount).to.be.lessThan(subsidyLimit);
            await checkUpdating(context, { newBaseAmount, newExtraAmount, subsidyLimit });
          });
        });

        describe("The initial subsidy limit (SL) is between the base amount and the sum amount, and", () => {
          it("The base amount becomes zero, but the extra amount does not change", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount + payment.extraAmount * 0.5);
            const newBaseAmount = 0;
            await checkUpdating(context, { newBaseAmount, subsidyLimit });
          });

          it("The base and extra amounts both become zero", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount + payment.extraAmount * 0.5);
            const newBaseAmount = 0;
            const newExtraAmount = 0;
            await checkUpdating(context, { newBaseAmount, newExtraAmount, refundAmount: 0, subsidyLimit });
          });

          it("The base amount decreases but the sum amount is still above SL", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount + payment.extraAmount * 0.5);
            const newBaseAmount = Math.floor(payment.baseAmount * 0.9);
            const newExtraAmount = Math.floor(payment.extraAmount * 0.9);
            expect(newBaseAmount + newExtraAmount).to.be.greaterThan(subsidyLimit);
            await checkUpdating(context, { newBaseAmount, newExtraAmount, subsidyLimit });
          });

          it("The base amount decreases and the sum amount becomes below SL", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount + payment.extraAmount * 0.5);
            const newBaseAmount = Math.floor(payment.baseAmount * 0.2);
            const newExtraAmount = Math.floor(payment.extraAmount * 0.2);
            expect(newBaseAmount + newExtraAmount).to.be.lessThan(subsidyLimit);
            await checkUpdating(context, { newBaseAmount, newExtraAmount, subsidyLimit });
          });

          it("The base amount increases above SL", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor(payment.baseAmount + payment.extraAmount * 0.5);
            const newBaseAmount = Math.floor(payment.baseAmount * 2);
            expect(newBaseAmount).to.be.greaterThan(subsidyLimit);
            await checkUpdating(context, { newBaseAmount, subsidyLimit });
          });
        });

        describe("The initial subsidy limit (SL) is above the payment sum amount, and", () => {
          it("The payment sum amount decreases", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor((payment.baseAmount + payment.extraAmount) * 1.2);
            const newBaseAmount = Math.floor(payment.baseAmount * 0.9);
            const newExtraAmount = Math.floor(payment.extraAmount * 0.9);
            await checkUpdating(context, { newBaseAmount, newExtraAmount, subsidyLimit });
          });

          it("The payment sum amount increases but it is still below SL", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor((payment.baseAmount + payment.extraAmount) * 1.2);
            const newBaseAmount = Math.floor(payment.baseAmount * 1.1);
            const newExtraAmount = Math.floor(payment.extraAmount * 1.1);
            expect(newBaseAmount + newExtraAmount).to.be.lessThan(subsidyLimit);
            await checkUpdating(context, { newBaseAmount, newExtraAmount, subsidyLimit });
          });

          it("The payment sum amount increases above SL but the base amount is still below SL", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor((payment.baseAmount + payment.extraAmount) * 1.2);
            const newBaseAmount = Math.floor(payment.baseAmount * 1.1);
            const newExtraAmount = Math.floor(payment.extraAmount * 1.5);
            expect(newBaseAmount + newExtraAmount).to.be.greaterThan(subsidyLimit);
            expect(newBaseAmount).to.be.lessThan(subsidyLimit);
            await checkUpdating(context, { newBaseAmount, newExtraAmount, subsidyLimit });
          });

          it("The payment sum amount increases above SL and the base amount becomes above SL", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const subsidyLimit = Math.floor((payment.baseAmount + payment.extraAmount) * 1.2);
            const newBaseAmount = Math.floor(payment.baseAmount * 2.5);
            const newExtraAmount = payment.extraAmount;
            expect(newBaseAmount + newExtraAmount).to.be.greaterThan(subsidyLimit);
            expect(newBaseAmount).to.be.greaterThan(subsidyLimit);
            await checkUpdating(context, { newBaseAmount, newExtraAmount, subsidyLimit });
          });
        });
      });

      describe("The payment is subsidized and confirmed, and", () => {
        it("The payment sum amount is increased", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
          const newBaseAmount = Math.floor(payment.baseAmount * 1.1);
          const newExtraAmount = Math.floor(payment.extraAmount * 1.1);
          const confirmedAmount = Math.floor(payment.baseAmount + payment.extraAmount * 0.5);
          await checkUpdating(context, { newBaseAmount, newExtraAmount, subsidyLimit, confirmedAmount });
        });

        it("The payment sum amount is decreased but the remainder is still above the confirmed amount", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
          const newBaseAmount = Math.floor(payment.baseAmount * 0.9);
          const newExtraAmount = Math.floor(payment.extraAmount * 0.9);
          const refundAmount = Math.floor(payment.baseAmount * 0.1);
          const remainder = newBaseAmount + newExtraAmount - refundAmount;
          const confirmedAmount = Math.floor(remainder * 0.9);
          await checkUpdating(
            context,
            { newBaseAmount, newExtraAmount, subsidyLimit, refundAmount, confirmedAmount },
          );
        });

        it("The payment sum amount decreased and the remainder becomes below the confirmed amount", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
          const newBaseAmount = Math.floor(payment.baseAmount * 0.7);
          const newExtraAmount = Math.floor(payment.extraAmount * 0.7);
          const refundAmount = Math.floor(payment.baseAmount * 0.1);
          const remainder = newBaseAmount + newExtraAmount - refundAmount;
          const confirmedAmount = Math.floor(remainder * 1.1);
          await checkUpdating(
            context,
            { newBaseAmount, newExtraAmount, subsidyLimit, refundAmount, confirmedAmount },
          );
        });

        it("The payment sum amount becomes zero", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
          const newBaseAmount = 0;
          const newExtraAmount = 0;
          const refundAmount = 0;
          const confirmedAmount = Math.floor(payment.baseAmount * 0.1);
          await checkUpdating(
            context,
            { newBaseAmount, newExtraAmount, subsidyLimit, refundAmount, confirmedAmount },
          );
        });
      });
    });

    describe("Is reverted if", () => {
      it("The contract is paused", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;
        await pauseContract(cardPaymentProcessorShell.contract);

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).updatePayment(
            payment.id,
            payment.baseAmount,
            payment.extraAmount,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("The caller does not have the executor role", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, deployer).updatePayment(
            payment.id,
            payment.baseAmount,
            payment.extraAmount,
          ),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
        ).withArgs(deployer.address, EXECUTOR_ROLE);
      });

      it("The payment ID is zero", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).updatePayment(
            ZERO_PAYMENT_ID,
            payment.baseAmount,
            payment.extraAmount,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_PAYMENT_ZERO_ID);
      });

      it("The payment with the provided ID does not exist", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).updatePayment(
            payment.id,
            payment.baseAmount,
            payment.extraAmount,
          ),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_PAYMENT_NON_EXISTENT,
        ).withArgs(payment.id);
      });

      it("The new sum amount is less than the refund amount", async () => {
        const context = await beforeMakingPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await cardPaymentProcessorShell.makeCommonPayments([payment]);
        const refundAmount = Math.floor((payment.baseAmount + payment.extraAmount) * 0.5);
        const newBaseAmount = Math.floor(payment.baseAmount * 0.4);
        const newExtraAmount = Math.floor(payment.baseAmount * 0.4);
        await cardPaymentProcessorShell.refundPayment(payment, refundAmount);

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).updatePayment(
            payment.id,
            newBaseAmount,
            newExtraAmount,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_INAPPROPRIATE_SUM_AMOUNT);
      });

      it("The new payment sum amount is greater than 64-bit unsigned integer", async () => {
        const context = await beforeMakingPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await cardPaymentProcessorShell.makeCommonPayments([payment]);
        const newBaseAmount = MAX_UINT64;
        const newExtraAmount = 1n;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).updatePayment(
            payment.id,
            newBaseAmount,
            newExtraAmount,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_OVERFLOW_OF_SUM_AMOUNT);
      });
    });
  });

  describe("Function 'revokePayment()'", () => {
    async function checkRevocation(context: TestContext, props: { cashbackRevocationFailure?: boolean } = {}) {
      const { cardPaymentProcessorShell, payments: [payment] } = context;
      const cashbackRevocationFailure = props.cashbackRevocationFailure ?? false;
      // To be sure that the `refundAmount` field is taken into account
      const refundAmount = Math.floor(payment.baseAmount * 0.1);
      await cardPaymentProcessorShell.refundPayment(payment, refundAmount);

      if (cashbackRevocationFailure) {
        cardPaymentProcessorShell.model.setCashbackRevocationStatus(CashbackOperationStatus.OutOfFunds);
      }
      const operationIndex = cardPaymentProcessorShell.model.revokePayment(payment.id);
      if (cashbackRevocationFailure) {
        const operation = cardPaymentProcessorShell.model.getPaymentOperation(operationIndex);
        await proveTx(context.tokenMock.setSpecialAmountToReturnFalse(Math.abs(operation.cashbackRequestedChange)));
      }
      const tx = (cardPaymentProcessorShell.contract.connect(executor) as Contract).revokePayment(payment.id);

      await context.checkPaymentOperationsForTx(tx);
      await context.checkCardPaymentProcessorState();
    }

    describe("Executes as expected if", () => {
      describe("The payment is not subsidized and not confirmed, and", () => {
        it("Cashback operations are enabled", async () => {
          const context = await beforeMakingPayments();
          const { cardPaymentProcessorShell, payments: [payment] } = context;
          await cardPaymentProcessorShell.makeCommonPayments([payment]);
          await checkRevocation(context);
        });

        it("Cashback operations are disabled before sending", async () => {
          const context = await beforeMakingPayments();
          await context.cardPaymentProcessorShell.disableCashback();
          await context.cardPaymentProcessorShell.makeCommonPayments([context.payments[0]]);
          await checkRevocation(context);
        });

        it("Cashback operations are disabled after sending", async () => {
          const context = await beforeMakingPayments();
          const { cardPaymentProcessorShell, payments: [payment] } = context;

          await cardPaymentProcessorShell.makeCommonPayments([payment]);
          await cardPaymentProcessorShell.disableCashback();

          await checkRevocation(context);
        });
      });

      describe("The payment is subsidized, but not confirmed, and cashback operations are enabled, and", () => {
        describe("The initial subsidy limit (SL) is", () => {
          it("Less than the payment base amount", async () => {
            const context = await beforeMakingPayments();
            const { cardPaymentProcessorShell, payments: [payment] } = context;

            const subsidyLimit = Math.floor(payment.baseAmount / 2);
            await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit });
            await checkRevocation(context);
          });

          it("Between the payment base amount and the sum amount", async () => {
            const context = await beforeMakingPayments();
            const { cardPaymentProcessorShell, payments: [payment] } = context;

            const subsidyLimit = payment.baseAmount + Math.floor(payment.extraAmount / 2);
            await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit });
            await checkRevocation(context);
          });

          it("Above the payment sum amount", async () => {
            const context = await beforeMakingPayments();
            const { cardPaymentProcessorShell, payments: [payment] } = context;

            const subsidyLimit = Math.floor((payment.baseAmount + payment.extraAmount) * 1.1);
            await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit });
            await checkRevocation(context);
          });
        });
      });

      describe("The payment is subsidized and confirmed, and cashback operations are enabled, and", () => {
        describe("The confirmed amount is", () => {
          it("Less than the payment sum amount", async () => {
            const context = await beforeMakingPayments();
            const { cardPaymentProcessorShell, payments: [payment] } = context;

            const subsidyLimit = Math.floor(payment.baseAmount / 2);
            const confirmationAmount = Math.floor(payment.baseAmount + payment.extraAmount / 2);
            await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit, confirmationAmount });
            await checkRevocation(context);
          });

          it("Equal to the payment sum amount", async () => {
            const context = await beforeMakingPayments();
            const { cardPaymentProcessorShell, payments: [payment] } = context;

            const subsidyLimit = Math.floor(payment.baseAmount / 2);
            const confirmationAmount = payment.baseAmount + payment.extraAmount;
            await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit, confirmationAmount });
            await checkRevocation(context);
          });
        });
      });
    });

    describe("Is reverted if", () => {
      it("The contract is paused", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;
        await pauseContract(cardPaymentProcessorShell.contract);

        await expect(connect(cardPaymentProcessorShell.contract, executor).revokePayment(payment.id))
          .to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("The caller does not have the executor role", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, deployer).revokePayment(payment.id),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
        ).withArgs(deployer.address, EXECUTOR_ROLE);
      });

      it("The payment ID is zero", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell } = context;

        await expect(connect(cardPaymentProcessorShell.contract, executor).revokePayment(ZERO_PAYMENT_ID))
          .to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_PAYMENT_ZERO_ID);
      });

      it("The payment with the provided ID does not exist", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(connect(cardPaymentProcessorShell.contract, executor).revokePayment(payment.id))
          .to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_PAYMENT_NON_EXISTENT)
          .withArgs(payment.id);
      });
    });
  });

  describe("Function 'reversePayment()'", () => {
    /* Since the function under test uses the same common internal function to cancel a payment,
     * the complete set of checks are provided in the test section for the 'revokePayment()' function.
     * In this section, only specific checks are provided.
     */
    it("Executes as expected if the payment is subsidized, confirmed, and cashback is enabled", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      await cardPaymentProcessorShell.makePaymentFor(
        payment,
        {
          sponsor,
          subsidyLimit: Math.floor(payment.baseAmount * 0.25),
          confirmationAmount: Math.floor((payment.baseAmount + payment.extraAmount) * 0.75),
        },
      );

      // To be sure that the `refundAmount` field is taken into account
      const refundAmount = Math.floor(payment.baseAmount * 0.15);
      await cardPaymentProcessorShell.refundPayment(payment, refundAmount);

      cardPaymentProcessorShell.model.reversePayment(payment.id);
      const tx = (cardPaymentProcessorShell.contract.connect(executor) as Contract).reversePayment(payment.id);

      await context.checkPaymentOperationsForTx(tx);
      await context.checkCardPaymentProcessorState();
    });

    it("Is reverted if the contract is paused", async () => {
      const context = await prepareForPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;
      await pauseContract(cardPaymentProcessorShell.contract);

      await expect(connect(cardPaymentProcessorShell.contract, executor).reversePayment(payment.id))
        .to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_ENFORCED_PAUSE);
    });

    it("Is reverted if the caller does not have the executor role", async () => {
      const context = await prepareForPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      await expect(
        connect(cardPaymentProcessorShell.contract, deployer).reversePayment(payment.id),
      ).to.be.revertedWithCustomError(
        cardPaymentProcessorShell.contract,
        ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
      ).withArgs(deployer.address, EXECUTOR_ROLE);
    });
  });

  describe("Function 'confirmPayment()'", () => {
    async function checkConfirmation(context: TestContext, confirmationAmount: number, refundAmount?: number) {
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
      await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit });
      if (refundAmount) {
        await cardPaymentProcessorShell.refundPayment(payment, refundAmount);
      }

      cardPaymentProcessorShell.model.confirmPayment(payment.id, confirmationAmount);
      const contractConnected = cardPaymentProcessorShell.contract.connect(executor) as Contract;
      const tx = contractConnected.confirmPayment(payment.id, confirmationAmount);

      await context.checkPaymentOperationsForTx(tx);
      await context.checkCardPaymentProcessorState();
    }

    describe("Executes as expected if", () => {
      describe("The refund amount is zero, and", () => {
        it("The confirmation amount is less than the remainder", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const confirmationAmount = Math.floor(payment.baseAmount + payment.extraAmount * 0.5);
          await checkConfirmation(context, confirmationAmount);
        });

        it("The confirmation amount equals the remainder", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const confirmationAmount = Math.floor(payment.baseAmount + payment.extraAmount);
          await checkConfirmation(context, confirmationAmount);
        });
      });

      describe("The refund amount is non-zero, and", () => {
        it("The confirmation amount is less than the remainder", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const refundAmount = Math.floor(payment.baseAmount * 0.1);
          const confirmationAmount = Math.floor(payment.baseAmount + payment.extraAmount * 0.5);
          await checkConfirmation(context, confirmationAmount, refundAmount);
        });

        it("The confirmation amount equals the remainder", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const refundAmount = Math.floor(payment.baseAmount * 0.1);
          const confirmationAmount = Math.floor(payment.baseAmount + payment.extraAmount - refundAmount);
          await checkConfirmation(context, confirmationAmount, refundAmount);
        });

        it("The confirmation is zero", async () => {
          const context = await beforeMakingPayments();
          const confirmationAmount = 0;
          await checkConfirmation(context, confirmationAmount);
        });
      });
    });

    describe("Is reverted if", () => {
      it("The contract is paused", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;
        await pauseContract(cardPaymentProcessorShell.contract);

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).confirmPayment(payment.id, ZERO_CONFIRMATION_AMOUNT),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("The caller does not have the executor role", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, deployer).confirmPayment(payment.id, ZERO_CONFIRMATION_AMOUNT),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
        ).withArgs(deployer.address, EXECUTOR_ROLE);
      });

      it("The payment ID is zero", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).confirmPayment(
            ZERO_PAYMENT_ID,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_PAYMENT_ZERO_ID);
      });

      it("The payment with the provided ID does not exist", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).confirmPayment(payment.id, ZERO_CONFIRMATION_AMOUNT),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_PAYMENT_NON_EXISTENT,
        ).withArgs(payment.id);
      });

      it("The confirmation amount is greater than the remainder", async () => {
        const context = await beforeMakingPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;
        const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
        await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit });
        const refundAmount = Math.floor(payment.baseAmount * 0.1);
        await cardPaymentProcessorShell.refundPayment(payment, refundAmount);
        const confirmationAmount = Math.floor(payment.baseAmount + payment.extraAmount - refundAmount) + 1;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).confirmPayment(payment.id, confirmationAmount),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_INAPPROPRIATE_CONFIRMATION_AMOUNT,
        );
      });
    });
  });

  describe("Function 'confirmPayments()'", () => {
    /* Since the function under test uses the same common internal function to confirm payments,
     * the complete set of checks are provided in the test section for the 'confirmPayment()' function.
     * In this section, only specific checks are provided.
     */
    it("Executes as expected", async () => {
      const context = await beforeMakingPayments({ paymentNumber: 2 });
      const { cardPaymentProcessorShell, payments } = context;
      await cardPaymentProcessorShell.makeCommonPayments([payments[0]]);
      const subsidyLimit = Math.floor(payments[1].baseAmount / 2);
      await cardPaymentProcessorShell.makePaymentFor(payments[1], { sponsor, subsidyLimit });
      const paymentConfirmations: PaymentConfirmation[] = [
        {
          paymentId: payments[0].id,
          amount: Math.floor(payments[0].baseAmount + payments[0].extraAmount * 0.5),
        },
        {
          paymentId: payments[1].id,
          amount: Math.floor(payments[1].baseAmount + payments[1].extraAmount),
        },
      ];
      const operationIndex1 = cardPaymentProcessorShell.model.confirmPayment(
        paymentConfirmations[0].paymentId,
        paymentConfirmations[0].amount,
      );
      const operationIndex2 = cardPaymentProcessorShell.model.confirmPayment(
        paymentConfirmations[1].paymentId,
        paymentConfirmations[1].amount,
      );
      const contractConnected = cardPaymentProcessorShell.contract.connect(executor) as Contract;
      const tx = contractConnected.confirmPayments(paymentConfirmations);
      await context.checkPaymentOperationsForTx(tx, [operationIndex1, operationIndex2]);
      await context.checkCardPaymentProcessorState();
    });

    it("Is reverted if the contract is paused", async () => {
      const context = await prepareForPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;
      await pauseContract(cardPaymentProcessorShell.contract);

      await expect(
        connect(cardPaymentProcessorShell.contract, executor).confirmPayments([{ paymentId: payment.id, amount: 0 }]),
      ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_ENFORCED_PAUSE);
    });

    it("Is reverted if the caller does not have the executor role", async () => {
      const context = await prepareForPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      await expect(
        connect(cardPaymentProcessorShell.contract, deployer).confirmPayments([{ paymentId: payment.id, amount: 0 }]),
      ).to.be.revertedWithCustomError(
        cardPaymentProcessorShell.contract,
        ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
      ).withArgs(deployer.address, EXECUTOR_ROLE);
    });

    it("Is reverted if the payment confirmation array is empty", async () => {
      const context = await prepareForPayments();
      const { cardPaymentProcessorShell } = context;

      await expect(connect(cardPaymentProcessorShell.contract, executor).confirmPayments([]))
        .to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_PAYMENT_CONFIRMATION_ARRAY_EMPTY);
    });
  });

  describe("Function 'updateLazyAndConfirmPayment()'", () => {
    /* Since the function under test uses the same common internal functions to update and confirm a payment,
     * the complete set of checks are provided in the test sections for
     * the 'updatePayment()' and `confirmPayment()` function.
     * In this section, only specific checks are provided.
     */
    async function checkLazyUpdating(
      context: TestContext,
      props: {
        newBaseAmount?: number;
        newExtraAmount?: number;
        confirmationAmount?: number;
      } = {},
    ) {
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      await cardPaymentProcessorShell.makePaymentFor(payment);

      await context.checkCardPaymentProcessorState();

      const newBaseAmount = props.newBaseAmount ?? payment.baseAmount;
      const newExtraAmount = props.newExtraAmount ?? payment.extraAmount;

      const operationIndex1 = cardPaymentProcessorShell.model.updatePayment(
        payment.id,
        newBaseAmount,
        newExtraAmount,
        UpdatingOperationKind.Lazy,
      );
      const operationIndex2 = cardPaymentProcessorShell.model.confirmPayment(
        payment.id,
        props.confirmationAmount ?? ZERO_CONFIRMATION_AMOUNT,
      );
      const tx = (cardPaymentProcessorShell.contract.connect(executor) as Contract).updateLazyAndConfirmPayment(
        payment.id,
        newBaseAmount,
        newExtraAmount,
        props.confirmationAmount ?? ZERO_CONFIRMATION_AMOUNT,
      );

      await context.checkPaymentOperationsForTx(tx, [operationIndex1, operationIndex2]);
      await context.checkCardPaymentProcessorState();
    }

    describe("Executes as expected if", () => {
      describe("The confirmation amount is zero, and", () => {
        it("The base amount and extra amount are both not changed", async () => {
          const context = await beforeMakingPayments();
          await checkLazyUpdating(context);
        });

        it("The base amount is changed, but the extra amount is not changed", async () => {
          const context = await beforeMakingPayments();
          const newBaseAmount = Math.floor(context.payments[0].baseAmount * 0.9);
          await checkLazyUpdating(context, { newBaseAmount });
        });

        it("The base amount is not changed, but the extra amount is changed", async () => {
          const context = await beforeMakingPayments();
          const newExtraAmount = Math.floor(context.payments[0].extraAmount * 0.9);
          await checkLazyUpdating(context, { newExtraAmount });
        });
      });

      describe("The confirmation amount is non-zero, and", () => {
        it("The base amount and extra amount are both not changed", async () => {
          const context = await beforeMakingPayments();
          const confirmationAmount = Math.floor(context.payments[0].baseAmount * 0.5);
          await checkLazyUpdating(context, { confirmationAmount });
        });

        it("The base amount is changed, but the extra amount is not changed", async () => {
          const context = await beforeMakingPayments();
          const confirmationAmount = Math.floor(context.payments[0].baseAmount * 0.5);
          const newBaseAmount = Math.floor(context.payments[0].baseAmount * 0.9);
          await checkLazyUpdating(context, { newBaseAmount, confirmationAmount });
        });

        it("The base amount is not changed, but the extra amount is changed", async () => {
          const context = await beforeMakingPayments();
          const confirmationAmount = Math.floor(context.payments[0].baseAmount * 0.5);
          const newExtraAmount = Math.floor(context.payments[0].extraAmount * 0.9);
          await checkLazyUpdating(context, { newExtraAmount, confirmationAmount });
        });
      });
    });

    describe("Is reverted if", () => {
      it("The contract is paused", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;
        await pauseContract(cardPaymentProcessorShell.contract);

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).updateLazyAndConfirmPayment(
            payment.id,
            payment.baseAmount,
            payment.extraAmount,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("The caller does not have the executor role", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, deployer).updateLazyAndConfirmPayment(
            payment.id,
            payment.baseAmount,
            payment.extraAmount,
            ZERO_CONFIRMATION_AMOUNT,
          ),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
        ).withArgs(deployer.address, EXECUTOR_ROLE);
      });
    });
  });

  describe("Function 'refundPayment()'", () => {
    async function checkRefunding(
      context: TestContext,
      props: {
        refundAmount: number;
        cashbackCondition?: CashbackConditionType;
        confirmedAmount?: number;
        subsidyLimit?: number;
      } = { refundAmount: 0, cashbackCondition: CashbackConditionType.CashbackEnabled },
    ) {
      const { cardPaymentProcessorShell, payments: [payment] } = context;
      const { cashbackCondition, subsidyLimit, confirmedAmount } = props;

      if (cashbackCondition === CashbackConditionType.CashbackDisabledBeforePaymentMaking) {
        await cardPaymentProcessorShell.disableCashback();
      }

      await cardPaymentProcessorShell.makePaymentFor(
        payment,
        { sponsor, subsidyLimit, confirmationAmount: confirmedAmount },
      );

      if (cashbackCondition === CashbackConditionType.CashbackDisabledAfterPaymentMaking) {
        await cardPaymentProcessorShell.disableCashback();
      }

      if (cashbackCondition === CashbackConditionType.CashbackEnabledButIncreasingPartial) {
        const actualCashbackChange = 2 * CASHBACK_ROUNDING_COEF;
        const presetCashbackAmount = MAX_CASHBACK_FOR_CAP_PERIOD - actualCashbackChange;
        await context.presetCashbackForAccount(payment.payer, presetCashbackAmount);
        cardPaymentProcessorShell.model.setCashbackIncreaseAmountResult(actualCashbackChange);
      }

      if (
        cashbackCondition === CashbackConditionType.CashbackEnabledButIncreasingReverts
      ) {
        throw new Error(`Unexpected cashback condition type: ${cashbackCondition}`);
      }

      await context.checkCardPaymentProcessorState();

      cardPaymentProcessorShell.model.refundPayment(
        payment.id,
        props.refundAmount,
      );

      const contractConnected = cardPaymentProcessorShell.contract.connect(executor) as Contract;
      const tx = contractConnected.refundPayment(payment.id, props.refundAmount);

      await context.checkPaymentOperationsForTx(tx);
      await context.checkCardPaymentProcessorState();
    }

    describe("Executes as expected if", () => {
      describe("The payment is not subsidized and not confirmed, and", () => {
        describe("The refund amount is less than base amount, and cashback is", () => {
          it("Enabled, and cashback operation is executed successfully", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const refundAmount = Math.floor(payment.baseAmount * 0.9);
            await checkRefunding(context, { refundAmount });
          });

          it("Disabled before payment making", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const refundAmount = Math.floor(payment.baseAmount * 0.9);
            await checkRefunding(context, {
              refundAmount,
              cashbackCondition: CashbackConditionType.CashbackDisabledBeforePaymentMaking,
            });
          });

          it("Disabled after payment making", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const refundAmount = Math.floor(payment.baseAmount * 0.9);
            await checkRefunding(context, {
              refundAmount,
              cashbackCondition: CashbackConditionType.CashbackDisabledAfterPaymentMaking,
            });
          });
        });

        describe("The refund amount equals the sum amount, and cashback is", () => {
          it("Enabled, and cashback operation is executed successfully", async () => {
            const context = await beforeMakingPayments();
            const { payments: [payment] } = context;
            const refundAmount = Math.floor(payment.baseAmount + payment.extraAmount);
            await checkRefunding(context, { refundAmount });
          });
        });

        describe("The refund amount is zero, and cashback is", () => {
          it("Enabled, and cashback operation is executed successfully", async () => {
            const context = await beforeMakingPayments();
            const refundAmount = 0;
            await checkRefunding(context, { refundAmount });
          });
        });
      });

      describe("The payment is subsidized but not confirmed, and cashback is enabled, and", () => {
        it("The refund amount is less than base amount", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const refundAmount = Math.floor(payment.baseAmount * 0.9);
          const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
          await checkRefunding(context, { refundAmount, subsidyLimit });
        });

        it("The refund amount equals the sum amount", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const refundAmount = Math.floor(payment.baseAmount + payment.extraAmount);
          const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
          await checkRefunding(context, { refundAmount, subsidyLimit });
        });

        it("The refund amount is zero, and cashback is", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const refundAmount = 0;
          const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
          await checkRefunding(context, { refundAmount, subsidyLimit });
        });
      });

      describe("The payment is subsidized and confirmed, and cashback is enabled, and", () => {
        it("The refund amount is less than non-confirmed amount", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const confirmedAmount = Math.floor(payment.baseAmount * 0.2);
          const refundAmount = Math.floor(payment.baseAmount * 0.3);
          const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
          await checkRefunding(context, { refundAmount, subsidyLimit, confirmedAmount });
        });

        it("The refund amount is the same as non-confirmed amount", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const sumAmount = Math.floor(payment.baseAmount + payment.extraAmount);
          const confirmedAmount = Math.floor(payment.baseAmount * 0.2);
          const refundAmount = sumAmount - confirmedAmount;
          const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
          await checkRefunding(context, { refundAmount, subsidyLimit, confirmedAmount });
        });

        it("The refund amount is greater than non-confirmed amount", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const sumAmount = Math.floor(payment.baseAmount + payment.extraAmount);
          const confirmedAmount = Math.floor(payment.baseAmount * 0.2);
          const refundAmount = Math.floor(sumAmount - payment.baseAmount * 0.1);
          const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
          await checkRefunding(context, { refundAmount, subsidyLimit, confirmedAmount });
        });

        it("The refund amount is zero", async () => {
          const context = await beforeMakingPayments();
          const { payments: [payment] } = context;
          const confirmedAmount = Math.floor(payment.baseAmount * 0.2);
          const refundAmount = 0;
          const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
          await checkRefunding(context, { refundAmount, subsidyLimit, confirmedAmount });
        });
      });
    });

    describe("Is reverted if", () => {
      it("The contract is paused", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;
        await pauseContract(cardPaymentProcessorShell.contract);

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).refundPayment(payment.id, ZERO_REFUND_AMOUNT),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("The caller does not have the executor role", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, deployer).refundPayment(payment.id, ZERO_REFUND_AMOUNT),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
        ).withArgs(deployer.address, EXECUTOR_ROLE);
      });

      it("The payment ID is zero", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).refundPayment(ZERO_PAYMENT_ID, ZERO_REFUND_AMOUNT),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_PAYMENT_ZERO_ID);
      });

      it("The payment with the provided ID does not exist", async () => {
        const context = await prepareForPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).refundPayment(payment.id, ZERO_REFUND_AMOUNT),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_PAYMENT_NON_EXISTENT,
        ).withArgs(payment.id);
      });

      it("The refund amount exceeds the sum amount", async () => {
        const context = await beforeMakingPayments();
        const { cardPaymentProcessorShell, payments: [payment] } = context;
        const subsidyLimit = Math.floor(payment.baseAmount * 0.5);
        const confirmationAmount = Math.floor(payment.baseAmount * 0.2);
        await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit, confirmationAmount });
        const refundAmount = payment.baseAmount + payment.extraAmount + 1;

        await expect(connect(cardPaymentProcessorShell.contract, executor).refundPayment(payment.id, refundAmount))
          .to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_INAPPROPRIATE_REFUNDING_AMOUNT);
      });
    });
  });

  describe("Function 'refundAccount()'", () => {
    const nonZeroTokenAmount = 123;
    const zeroTokenAmount = 0;

    async function checkRefundingAccount(tokenAmount: number) {
      const { cardPaymentProcessorShell, tokenMock } = await prepareForPayments();
      await proveTx(tokenMock.mint(cashOutAccount.address, tokenAmount));

      const contractConnected = cardPaymentProcessorShell.contract.connect(executor) as Contract;
      const tx = await contractConnected.refundAccount(user1.address, tokenAmount);

      await expect(tx).to.emit(cardPaymentProcessorShell.contract, EVENT_NAME_ACCOUNT_REFUNDED).withArgs(
        user1.address,
        tokenAmount,
        "0x",
      );

      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [user1, cashOutAccount, cardPaymentProcessorShell.contract],
        [+tokenAmount, -tokenAmount, 0],
      );
    }

    describe("Executes as expected and emits the correct events if the refund amount is", () => {
      it("Non-zero", async () => {
        await checkRefundingAccount(nonZeroTokenAmount);
      });

      it("Zero", async () => {
        await checkRefundingAccount(zeroTokenAmount);
      });
    });

    describe("Is reverted if", () => {
      it("The contract is paused", async () => {
        const { cardPaymentProcessorShell } = await prepareForPayments();
        await pauseContract(cardPaymentProcessorShell.contract);

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).refundAccount(user1.address, nonZeroTokenAmount),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_ENFORCED_PAUSE);
      });

      it("The caller does not have the executor role", async () => {
        const { cardPaymentProcessorShell } = await prepareForPayments();

        await expect(
          connect(cardPaymentProcessorShell.contract, deployer).refundAccount(user1.address, nonZeroTokenAmount),
        ).to.be.revertedWithCustomError(
          cardPaymentProcessorShell.contract,
          ERROR_NAME_ACCESS_CONTROL_UNAUTHORIZED_ACCOUNT,
        ).withArgs(deployer.address, EXECUTOR_ROLE);
      });

      it("The account address is zero", async () => {
        const { cardPaymentProcessorShell } = await prepareForPayments();

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).refundAccount(ZERO_ADDRESS, nonZeroTokenAmount),
        ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_ACCOUNT_ZERO_ADDRESS);
      });

      it("The cash-out account does not have enough token balance", async () => {
        const { cardPaymentProcessorShell, tokenMock } = await prepareForPayments();
        const tokenAmount = nonZeroTokenAmount;
        await proveTx(tokenMock.mint(cashOutAccount.address, tokenAmount - 1));

        await expect(
          connect(cardPaymentProcessorShell.contract, executor).refundAccount(user1.address, tokenAmount),
        ).to.be.revertedWithCustomError(
          tokenMock,
          ERROR_NAME_ERC20_INSUFFICIENT_BALANCE,
        ).withArgs(cashOutAccount.address, anyValue, anyValue);
      });
    });
  });

  describe("Complex scenarios", () => {
    async function checkRevertingOfAllPaymentProcessingFunctionsExceptMaking(
      cardPaymentProcessor: Contract,
      payments: TestPayment[],
      status: PaymentStatus,
    ) {
      const paymentIds = payments.map(payment => payment.id);

      await expect(connect(cardPaymentProcessor, executor).revokePayment(paymentIds[0]))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_INAPPROPRIATE_PAYMENT_STATUS)
        .withArgs(paymentIds[0], status);

      await expect(connect(cardPaymentProcessor, executor).reversePayment(paymentIds[0]))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_INAPPROPRIATE_PAYMENT_STATUS)
        .withArgs(paymentIds[0], status);

      await expect(connect(cardPaymentProcessor, executor).confirmPayment(paymentIds[0], ZERO_CONFIRMATION_AMOUNT))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_INAPPROPRIATE_PAYMENT_STATUS)
        .withArgs(paymentIds[0], status);

      const paymentConfirmations: PaymentConfirmation[] = paymentIds.map((id) => {
        return {
          paymentId: id,
          amount: ZERO_CONFIRMATION_AMOUNT,
        };
      });

      await expect(connect(cardPaymentProcessor, executor).confirmPayments(paymentConfirmations))
        .to.be.revertedWithCustomError(cardPaymentProcessor, ERROR_NAME_INAPPROPRIATE_PAYMENT_STATUS)
        .withArgs(paymentIds[0], status);

      await expect(
        connect(cardPaymentProcessor, executor).updatePayment(
          paymentIds[0],
          payments[0].baseAmount,
          payments[0].extraAmount,
        ),
      ).to.be.revertedWithCustomError(
        cardPaymentProcessor,
        ERROR_NAME_INAPPROPRIATE_PAYMENT_STATUS,
      ).withArgs(
        paymentIds[0],
        status,
      );

      await expect(
        connect(cardPaymentProcessor, executor).updateLazyAndConfirmPayment(
          paymentIds[0],
          payments[0].baseAmount,
          payments[0].extraAmount,
          ZERO_CONFIRMATION_AMOUNT,
        ),
      ).to.be.revertedWithCustomError(
        cardPaymentProcessor,
        ERROR_NAME_INAPPROPRIATE_PAYMENT_STATUS,
      ).withArgs(
        paymentIds[0],
        status,
      );

      await expect(
        connect(cardPaymentProcessor, executor).refundPayment(
          paymentIds[0],
          ZERO_REFUND_AMOUNT,
        ),
      ).to.be.revertedWithCustomError(
        cardPaymentProcessor,
        ERROR_NAME_INAPPROPRIATE_PAYMENT_STATUS,
      ).withArgs(
        paymentIds[0],
        status,
      );
    }

    it("All payment processing functions except making are reverted if a payment was revoked", async () => {
      const context = await beforeMakingPayments({ paymentNumber: 2 });
      const { cardPaymentProcessorShell, payments } = context;

      await cardPaymentProcessorShell.makeCommonPayments(payments);
      await cardPaymentProcessorShell.revokePayment(payments[0]);

      await context.checkCardPaymentProcessorState();

      await checkRevertingOfAllPaymentProcessingFunctionsExceptMaking(
        cardPaymentProcessorShell.contract,
        payments,
        PaymentStatus.Revoked,
      );

      cardPaymentProcessorShell.model.makePayment(payments[0], { sender: executor });
      const tx = (cardPaymentProcessorShell.contract.connect(executor) as Contract).makePaymentFor(
        payments[0].id,
        payments[0].payer.address,
        payments[0].baseAmount,
        payments[0].extraAmount,
        ZERO_SPONSOR_ADDRESS,
        ZERO_SUBSIDY_LIMIT,
        CASHBACK_RATE_AS_IN_CONTRACT,
        ZERO_CONFIRMATION_AMOUNT,
      );
      await context.checkPaymentOperationsForTx(tx);
      await context.checkCardPaymentProcessorState();
    });

    it("All payment processing functions are reverted if a payment was reversed", async () => {
      const context = await beforeMakingPayments({ paymentNumber: 2 });
      const { cardPaymentProcessorShell, payments } = context;

      await cardPaymentProcessorShell.makeCommonPayments(payments);
      await cardPaymentProcessorShell.reversePayment(payments[0]);

      await expect(
        connect(cardPaymentProcessorShell.contract, executor).makePaymentFor(
          payments[0].id,
          payments[0].payer.address,
          payments[0].baseAmount,
          payments[0].extraAmount,
          ZERO_SPONSOR_ADDRESS,
          ZERO_SUBSIDY_LIMIT,
          CASHBACK_RATE_AS_IN_CONTRACT,
          ZERO_CONFIRMATION_AMOUNT,
        ),
      ).to.be.revertedWithCustomError(cardPaymentProcessorShell.contract, ERROR_NAME_PAYMENT_ALREADY_EXISTENT);

      await checkRevertingOfAllPaymentProcessingFunctionsExceptMaking(
        cardPaymentProcessorShell.contract,
        payments,
        PaymentStatus.Reversed,
      );
      await context.checkCardPaymentProcessorState();
    });

    it("Several refund and payment updating operations execute as expected if cashback is enabled", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      await cardPaymentProcessorShell.makeCommonPayments([payment]);

      await context.checkCardPaymentProcessorState();

      await cardPaymentProcessorShell.updatePayment(payment, Math.floor(payment.baseAmount * 2));
      await cardPaymentProcessorShell.refundPayment(payment, Math.floor(payment.baseAmount * 0.1));
      await cardPaymentProcessorShell.updatePayment(
        payment,
        Math.floor(payment.baseAmount * 0.9),
        Math.floor(payment.extraAmount * 1.1),
      );
      await cardPaymentProcessorShell.refundPayment(
        payment,
        Math.floor(payment.baseAmount * 0.2),
      );
      await cardPaymentProcessorShell.updatePayment(payment, Math.floor(payment.baseAmount * 1.5));
      await context.checkCardPaymentProcessorState();

      await cardPaymentProcessorShell.refundPayment(payment, Math.floor(payment.baseAmount * 0.3));
      await context.checkCardPaymentProcessorState();

      let currentPayment: PaymentModel = cardPaymentProcessorShell.model.getPaymentById(payment.id);
      const confirmationAmount =
        currentPayment.baseAmount + currentPayment.extraAmount - currentPayment.refundAmount - CASHBACK_ROUNDING_COEF;
      const operationResult: OperationResult =
        await cardPaymentProcessorShell.confirmPayment(payment, confirmationAmount);
      await context.checkPaymentOperationsForTx(operationResult.tx);
      await context.checkCardPaymentProcessorState();

      await cardPaymentProcessorShell.refundPayment(payment, Math.floor(payment.baseAmount * 0.4));
      currentPayment = cardPaymentProcessorShell.model.getPaymentById(payment.id);
      const refundAmount =
        currentPayment.baseAmount + currentPayment.extraAmount - currentPayment.refundAmount;
      await cardPaymentProcessorShell.refundPayment(payment, refundAmount);
      await context.checkCardPaymentProcessorState();
    });

    it("Revocation executes correctly for a payment with and without extra amount, cashback, subsidy", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      await cardPaymentProcessorShell.makePaymentFor(
        payment,
        {
          sponsor,
          subsidyLimit: Math.floor(payment.baseAmount * 0.75),
          confirmationAmount: Math.floor(payment.baseAmount * 0.25),
        },
      );
      await cardPaymentProcessorShell.revokePayment(payment);
      await context.checkCardPaymentProcessorState();

      payment.extraAmount = 0;
      await cardPaymentProcessorShell.disableCashback();
      await cardPaymentProcessorShell.makePaymentFor(payment);
      await context.checkCardPaymentProcessorState();
      await cardPaymentProcessorShell.revokePayment(payment);
      await context.checkCardPaymentProcessorState();
    });

    it("Refunding executes as expected if the initial cashback was capped", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      const presetCashbackAmount = MAX_CASHBACK_FOR_CAP_PERIOD - CASHBACK_ROUNDING_COEF;
      await context.presetCashbackForAccount(payment.payer, presetCashbackAmount);
      await cardPaymentProcessorShell.makePaymentFor(payment);
      const refundAmount = Math.floor(payment.baseAmount * 0.1);
      await cardPaymentProcessorShell.refundPayment(payment, refundAmount);
      await context.checkCardPaymentProcessorState();
    });

    it("Updating with cashback decreasing executes as expected if the initial cashback was capped", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      const presetCashbackAmount = MAX_CASHBACK_FOR_CAP_PERIOD - CASHBACK_ROUNDING_COEF;
      await context.presetCashbackForAccount(payment.payer, presetCashbackAmount);
      await cardPaymentProcessorShell.makePaymentFor(payment);
      const newBaseAmount = Math.floor(payment.baseAmount * 0.1);
      await cardPaymentProcessorShell.updatePayment(payment, newBaseAmount);
      await context.checkCardPaymentProcessorState();
    });

    it("Updating with cashback increasing executes as expected if the initial cashback was capped", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      const presetCashbackAmount = MAX_CASHBACK_FOR_CAP_PERIOD - CASHBACK_ROUNDING_COEF;
      await context.presetCashbackForAccount(payment.payer, presetCashbackAmount);
      await cardPaymentProcessorShell.makePaymentFor(payment);
      const newBaseAmount = Math.floor(payment.baseAmount * 1.5);
      await cardPaymentProcessorShell.updatePayment(payment, newBaseAmount);
      await context.checkCardPaymentProcessorState();
    });

    it("Updating with cashback decreasing executes as expected if the initial cashback was capped", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      const presetCashbackAmount = MAX_CASHBACK_FOR_CAP_PERIOD - CASHBACK_ROUNDING_COEF;
      await context.presetCashbackForAccount(payment.payer, presetCashbackAmount);
      await cardPaymentProcessorShell.makePaymentFor(payment);
      const newBaseAmount = Math.floor(payment.baseAmount * 0.1);
      await cardPaymentProcessorShell.updatePayment(payment, newBaseAmount);
      await context.checkCardPaymentProcessorState();
    });
  });

  describe("Token transfer demonstration scenarios", () => {
    interface ExpectedBalanceChanges {
      payer?: number;
      sponsor?: number;
      cardPaymentProcessor?: number;
      cashOutAccount?: number;
      cashbackTreasury?: number;
    }

    async function checkBalanceChanges(
      context: TestContext,
      operationResult: Promise<OperationResult>,
      expectedBalanceChanges: ExpectedBalanceChanges,
    ) {
      const tx = (await operationResult).tx;
      await expect(tx).to.changeTokenBalances(
        context.tokenMock,
        [
          context.payments[0].payer,
          sponsor,
          context.cardPaymentProcessorShell.contract,
          context.cashOutAccount,
          context.cashbackTreasury,
        ],
        [
          expectedBalanceChanges.payer ?? 0,
          expectedBalanceChanges.sponsor ?? 0,
          expectedBalanceChanges.cardPaymentProcessor ?? 0,
          expectedBalanceChanges.cashOutAccount ?? 0,
          expectedBalanceChanges.cashbackTreasury ?? 0,
        ],
      );
    }

    it("Making a payment with cashback, example 1: a partially subsidized payment", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      payment.baseAmount = 1000 * DIGITS_COEF;
      payment.extraAmount = 400 * DIGITS_COEF;
      const subsidyLimit = 800 * DIGITS_COEF;
      const cashbackRate = 200; // 20 %

      const opResult = cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit, cashbackRate });

      const cashbackChange = 40 * DIGITS_COEF;
      const expectedBalanceChanges: ExpectedBalanceChanges = {
        payer: -600 * DIGITS_COEF + cashbackChange,
        sponsor: -800 * DIGITS_COEF,
        cardPaymentProcessor: 1400 * DIGITS_COEF,
        cashbackTreasury: -cashbackChange,
      };
      await checkBalanceChanges(context, opResult, expectedBalanceChanges);
    });

    it("Making a payment with cashback, example 2: a fully subsidized payment", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      payment.baseAmount = 1000 * DIGITS_COEF;
      payment.extraAmount = 400 * DIGITS_COEF;
      const subsidyLimit = 2000 * DIGITS_COEF;
      const cashbackRate = 200; // 20 %

      const opResult = cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit, cashbackRate });

      const cashbackChange = 0;
      const expectedBalanceChanges: ExpectedBalanceChanges = {
        payer: -0 + cashbackChange,
        sponsor: -1400 * DIGITS_COEF,
        cardPaymentProcessor: 1400 * DIGITS_COEF,
        cashbackTreasury: -cashbackChange,
      };
      await checkBalanceChanges(context, opResult, expectedBalanceChanges);
    });

    it("Making a payment with cashback, example 3: cashback rounding up", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      const cashbackRate = 200; // 20 %
      payment.baseAmount = Math.floor(2.5 * CASHBACK_ROUNDING_COEF / (cashbackRate / 1000));
      payment.extraAmount = 0;

      const opResult = cardPaymentProcessorShell.makePaymentFor(payment, { cashbackRate });

      const cashbackChange = 3 * CASHBACK_ROUNDING_COEF;
      const expectedBalanceChanges: ExpectedBalanceChanges = {
        payer: -payment.baseAmount + cashbackChange,
        sponsor: -0,
        cardPaymentProcessor: payment.baseAmount,
        cashbackTreasury: -cashbackChange,
      };
      await checkBalanceChanges(context, opResult, expectedBalanceChanges);
    });

    it("Making a payment with cashback, example 4: cashback rounding down", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      const cashbackRate = 200; // 20 %
      payment.baseAmount = Math.floor(2.49999 * CASHBACK_ROUNDING_COEF / (cashbackRate / 1000));
      payment.extraAmount = 0;

      const opResult = cardPaymentProcessorShell.makePaymentFor(payment, { cashbackRate });

      const cashbackChange = 2 * CASHBACK_ROUNDING_COEF;
      const expectedBalanceChanges: ExpectedBalanceChanges = {
        payer: -payment.baseAmount + cashbackChange,
        sponsor: -0,
        cardPaymentProcessor: payment.baseAmount,
        cashbackTreasury: -cashbackChange,
      };
      await checkBalanceChanges(context, opResult, expectedBalanceChanges);
    });

    it("Making a payment with cashback, example 1: a partially subsidized payment with confirmation", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      payment.baseAmount = 1000 * DIGITS_COEF;
      payment.extraAmount = 400 * DIGITS_COEF;
      const subsidyLimit = 800 * DIGITS_COEF;
      const cashbackRate = 200; // 20 %
      const confirmationAmount = 1100 * DIGITS_COEF;

      const opResult = cardPaymentProcessorShell.makePaymentFor(
        payment,
        { sponsor, subsidyLimit, cashbackRate, confirmationAmount },
      );

      const cashbackChange = 40 * DIGITS_COEF;
      const expectedBalanceChanges: ExpectedBalanceChanges = {
        payer: -600 * DIGITS_COEF + cashbackChange,
        sponsor: -800 * DIGITS_COEF,
        cardPaymentProcessor: 1400 * DIGITS_COEF - confirmationAmount,
        cashbackTreasury: -cashbackChange,
        cashOutAccount: confirmationAmount,
      };
      await checkBalanceChanges(context, opResult, expectedBalanceChanges);
    });

    it("Updating a payment with cashback, example 1: increasing a partially subsidized payment", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      payment.baseAmount = 1000 * DIGITS_COEF;
      payment.extraAmount = 400 * DIGITS_COEF;
      const subsidyLimit = 800 * DIGITS_COEF;
      const cashbackRate = 200; // 20 %
      const newBaseAmount = 1200 * DIGITS_COEF;
      const newExtraAmount = 600 * DIGITS_COEF;

      await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit, cashbackRate });
      const opResult = cardPaymentProcessorShell.updatePayment(payment, newBaseAmount, newExtraAmount);

      const oldCashback = 40 * DIGITS_COEF;
      const newCashback = 80 * DIGITS_COEF;
      const cashbackChange = newCashback - oldCashback;

      const expectedBalanceChanges: ExpectedBalanceChanges = {
        payer: -400 * DIGITS_COEF + cashbackChange,
        sponsor: 0,
        cardPaymentProcessor: +400 * DIGITS_COEF,
        cashbackTreasury: -cashbackChange,
      };
      await checkBalanceChanges(context, opResult, expectedBalanceChanges);
    });

    it("Updating a payment with cashback, example 2: decreasing a partially subsidized payment", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      payment.baseAmount = 1200 * DIGITS_COEF;
      payment.extraAmount = 600 * DIGITS_COEF;
      const subsidyLimit = 800 * DIGITS_COEF;
      const cashbackRate = 200; // 20 %
      const newBaseAmount = 400 * DIGITS_COEF;
      const newExtraAmount = 200 * DIGITS_COEF;

      await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit, cashbackRate });
      const opResult = cardPaymentProcessorShell.updatePayment(payment, newBaseAmount, newExtraAmount);

      const oldCashback = 80 * DIGITS_COEF;
      const newCashback = 0;
      const cashbackChange = newCashback - oldCashback;

      const expectedBalanceChanges: ExpectedBalanceChanges = {
        payer: +1000 * DIGITS_COEF + cashbackChange,
        sponsor: +200 * DIGITS_COEF,
        cardPaymentProcessor: -1200 * DIGITS_COEF,
        cashbackTreasury: -cashbackChange,
      };
      await checkBalanceChanges(context, opResult, expectedBalanceChanges);
    });

    it("Updating a payment with cashback, example 3: increasing a fully subsidized payment", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      payment.baseAmount = 400 * DIGITS_COEF;
      payment.extraAmount = 200 * DIGITS_COEF;
      const subsidyLimit = 800 * DIGITS_COEF;
      const cashbackRate = 200; // 20 %
      const newBaseAmount = 1200 * DIGITS_COEF;
      const newExtraAmount = 600 * DIGITS_COEF;

      await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit, cashbackRate });
      const opResult = cardPaymentProcessorShell.updatePayment(payment, newBaseAmount, newExtraAmount);

      const oldCashback = 0;
      const newCashback = 80 * DIGITS_COEF;
      const cashbackChange = newCashback - oldCashback;

      const expectedBalanceChanges: ExpectedBalanceChanges = {
        payer: -1000 * DIGITS_COEF + cashbackChange,
        sponsor: -200 * DIGITS_COEF,
        cardPaymentProcessor: +1200 * DIGITS_COEF,
        cashbackTreasury: -cashbackChange,
      };
      await checkBalanceChanges(context, opResult, expectedBalanceChanges);
    });

    it("Refunding a payment with cashback, example 1: the confirmed amount is zero", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      payment.baseAmount = 1000 * DIGITS_COEF;
      payment.extraAmount = 600 * DIGITS_COEF;
      const subsidyLimit = 800 * DIGITS_COEF;
      const cashbackRate = 200; // 20 %
      const refundAmount = 400 * DIGITS_COEF;

      await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit, cashbackRate });
      const opResult = cardPaymentProcessorShell.refundPayment(payment, refundAmount);

      const oldCashback = 40 * DIGITS_COEF;
      const newCashback = 24 * DIGITS_COEF;
      const cashbackChange = newCashback - oldCashback;

      const expectedBalanceChanges: ExpectedBalanceChanges = {
        payer: +80 * DIGITS_COEF + cashbackChange,
        sponsor: +320 * DIGITS_COEF,
        cardPaymentProcessor: -400 * DIGITS_COEF,
        cashbackTreasury: -cashbackChange,
      };
      await checkBalanceChanges(context, opResult, expectedBalanceChanges);
    });

    it("Refunding a payment with cashback, example 2: the confirmed amount is non-zero", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      payment.baseAmount = 1000 * DIGITS_COEF;
      payment.extraAmount = 600 * DIGITS_COEF;
      const subsidyLimit = 800 * DIGITS_COEF;
      const cashbackRate = 200; // 20 %
      const refundAmount = 400 * DIGITS_COEF;
      const confirmationAmount = 1500 * DIGITS_COEF;

      await cardPaymentProcessorShell.makePaymentFor(
        payment,
        { sponsor, subsidyLimit, cashbackRate, confirmationAmount },
      );
      const opResult = cardPaymentProcessorShell.refundPayment(payment, refundAmount);

      const oldCashback = 40 * DIGITS_COEF;
      const newCashback = 24 * DIGITS_COEF;
      const cashbackChange = newCashback - oldCashback;

      const expectedBalanceChanges: ExpectedBalanceChanges = {
        payer: +80 * DIGITS_COEF + cashbackChange,
        sponsor: +320 * DIGITS_COEF,
        cardPaymentProcessor: -100 * DIGITS_COEF,
        cashbackTreasury: -cashbackChange,
        cashOutAccount: -300 * DIGITS_COEF,
      };
      await checkBalanceChanges(context, opResult, expectedBalanceChanges);
    });

    it("Revoking a payment with cashback, example 1: a partially subsidized payment", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      payment.baseAmount = 1000 * DIGITS_COEF;
      payment.extraAmount = 400 * DIGITS_COEF;
      const subsidyLimit = 800 * DIGITS_COEF;
      const cashbackRate = 200; // 20 %
      const confirmationAmount = 1200 * DIGITS_COEF;

      await cardPaymentProcessorShell.makePaymentFor(
        payment,
        { sponsor, subsidyLimit, cashbackRate, confirmationAmount },
      );
      const opResult = cardPaymentProcessorShell.revokePayment(payment);

      const oldCashback = 40 * DIGITS_COEF;
      const newCashback = 0;
      const cashbackChange = newCashback - oldCashback;

      const expectedBalanceChanges: ExpectedBalanceChanges = {
        payer: +600 * DIGITS_COEF + cashbackChange,
        sponsor: +800 * DIGITS_COEF,
        cardPaymentProcessor: -200 * DIGITS_COEF,
        cashbackTreasury: -cashbackChange,
        cashOutAccount: -1200 * DIGITS_COEF,
      };
      await checkBalanceChanges(context, opResult, expectedBalanceChanges);
    });

    it("Revoking a payment with cashback, example 2: a fully subsidized payment", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      payment.baseAmount = 1000 * DIGITS_COEF;
      payment.extraAmount = 400 * DIGITS_COEF;
      const subsidyLimit = 2000 * DIGITS_COEF;
      const cashbackRate = 200; // 20 %
      const confirmationAmount = 1200 * DIGITS_COEF;

      await cardPaymentProcessorShell.makePaymentFor(
        payment,
        { sponsor, subsidyLimit, cashbackRate, confirmationAmount },
      );
      const opResult = cardPaymentProcessorShell.revokePayment(payment);

      const oldCashback = 0;
      const newCashback = 0;
      const cashbackChange = newCashback - oldCashback;

      const expectedBalanceChanges: ExpectedBalanceChanges = {
        payer: cashbackChange,
        sponsor: +1400 * DIGITS_COEF,
        cardPaymentProcessor: -200 * DIGITS_COEF,
        cashbackTreasury: -cashbackChange,
        cashOutAccount: -1200 * DIGITS_COEF,
      };
      await checkBalanceChanges(context, opResult, expectedBalanceChanges);
    });

    it("Confirming a payment with cashback, example 1", async () => {
      const context = await beforeMakingPayments();
      const { cardPaymentProcessorShell, payments: [payment] } = context;

      payment.baseAmount = 1000 * DIGITS_COEF;
      payment.extraAmount = 400 * DIGITS_COEF;
      const subsidyLimit = 800 * DIGITS_COEF;
      const cashbackRate = 200; // 20 %
      const confirmationAmount = 1200 * DIGITS_COEF;

      await cardPaymentProcessorShell.makePaymentFor(payment, { sponsor, subsidyLimit, cashbackRate });
      const opResult = await cardPaymentProcessorShell.confirmPayment(payment, confirmationAmount);

      const expectedBalanceChanges: ExpectedBalanceChanges = {
        cardPaymentProcessor: -1200 * DIGITS_COEF,
        cashOutAccount: +1200 * DIGITS_COEF,
      };
      await checkBalanceChanges(context, Promise.resolve(opResult), expectedBalanceChanges);
    });
  });

  describe("Scenario with cashback periodic cap", () => {
    async function checkAccountCashbackState(
      context: TestContext,
      expectedCapPeriodStartTime: number,
    ) {
      const { cardPaymentProcessorShell, payments: [payment] } = context;
      const actualAccountCashback: AccountCashbackState =
        await cardPaymentProcessorShell.cashbackControllerContract.getAccountCashback(payment.payer.address);
      const expectedTotalCashback = cardPaymentProcessorShell.model.getCashbackTotalForAccount(payment.payer.address);
      const expectedCapPeriodStartAmount = cardPaymentProcessorShell.model.capPeriodStartAmount;
      expect(actualAccountCashback.totalAmount).to.equal(expectedTotalCashback);
      expect(actualAccountCashback.capPeriodStartAmount).to.equal(expectedCapPeriodStartAmount);
      expect(actualAccountCashback.capPeriodStartTime).to.equal(expectedCapPeriodStartTime);
    }

    it("Executes as expected", async () => {
      const context = await beforeMakingPayments({ paymentNumber: 2 });

      const { cardPaymentProcessorShell } = context;
      const payment: TestPayment = { ...context.payments[0] };

      // Check initial cashback state for the account after the first cashback transfer
      const operationResult1 = await cardPaymentProcessorShell.makePaymentFor(payment);
      const expectedCapPeriodStartTime1 = await getTxTimestamp(operationResult1.tx);
      await checkAccountCashbackState(context, expectedCapPeriodStartTime1);

      // Reach the cashback cap first time.
      await context.presetCashbackForAccount(payment.payer, MAX_CASHBACK_FOR_CAP_PERIOD);
      await checkAccountCashbackState(context, expectedCapPeriodStartTime1);

      // Revoke cashback and check that the cap-related values are changed properly
      await cardPaymentProcessorShell.revokePayment(payment);
      await checkAccountCashbackState(context, expectedCapPeriodStartTime1);

      // Reach the cashback cap again
      await cardPaymentProcessorShell.makePaymentFor(payment);
      await checkAccountCashbackState(context, expectedCapPeriodStartTime1);

      // The following part of the test is executed only for Hardhat network because we need to shift block time
      if (network.name !== "hardhat" && network.name !== "stratus") {
        return;
      }

      // Shift next block time for a period of cap checking
      await increaseBlockTimestamp(CASHBACK_CAP_RESET_PERIOD + 1);

      // Set new start amount for the cashback cap checking in the model
      cardPaymentProcessorShell.model.capPeriodStartAmount =
        cardPaymentProcessorShell.model.getCashbackTotalForAccount(payment.payer.address);

      // Check that next cashback sending executes successfully due to the cap period resets
      payment.id = context.payments[1].id;
      const operationResult2 = await cardPaymentProcessorShell.makePaymentFor(payment);
      const expectedCapPeriodStartTime2 = await getTxTimestamp(operationResult2.tx);
      await checkAccountCashbackState(context, expectedCapPeriodStartTime2);

      // Revoke the very first cashback and check that the cap-related values are changed properly
      payment.id = context.payments[0].id;
      await cardPaymentProcessorShell.revokePayment(payment);
      await checkAccountCashbackState(context, expectedCapPeriodStartTime2);
    });
  });

  describe("Token transfer demonstration scenarios with CV enabled", () => {
    let cardPaymentProcessorShell: CardPaymentProcessorShell;
    let cashbackVault: Contracts.CashbackVault;
    let context: TestContext;
    let tokenMock: Contracts.ERC20TokenMock;

    beforeEach(async () => {
      context = await beforeMakingPayments();
      cardPaymentProcessorShell = context.cardPaymentProcessorShell;
      tokenMock = context.tokenMock as unknown as Contracts.ERC20TokenMock;
      await setUpFixture(async function configureCV() {
        const cashbackVaultFactory = await ethers.getContractFactory("CashbackVault");
        cashbackVault = await upgrades.deployProxy(cashbackVaultFactory, [getAddress(context.tokenMock)]);
        await cashbackVault.waitForDeployment();

        await cashbackVault.grantRole(GRANTOR_ROLE, deployer.address);
        await cashbackVault.grantRole(
          CASHBACK_OPERATOR_ROLE,
          getAddress(cardPaymentProcessorShell.cashbackControllerContract),
        );
        await cashbackVault.grantRole(MANAGER_ROLE, deployer.address);
        await cardPaymentProcessorShell.cashbackControllerContract.setCashbackVault(getAddress(cashbackVault));
      });
    });

    describe("Making a payment with cashback", () => {
      let tx: Promise<TransactionResponse>;
      let cashbackAmount: number;
      let payer: HardhatEthersSigner;
      let payment: TestPayment;
      beforeEach(async () => {
        payment = { ...context.payments[0] };
        payer = payment.payer;
        tx = (await cardPaymentProcessorShell.makePaymentFor(payment)).tx;
        cashbackAmount =
          cardPaymentProcessorShell.model.getCashbackTotalForAccount(payer.address);
      });

      it("should transfer tokens from treasury to cashback vault", async () => {
        await expect(tx).to.changeTokenBalances(tokenMock,
          [context.cashbackTreasury.address, getAddress(cashbackVault)],
          [-cashbackAmount, cashbackAmount]);
      });

      it("should increase the claimable amount in vault for the payer", async () => {
        expect(await cashbackVault.getAccountCashbackBalance(payer.address)).to.equal(cashbackAmount);
      });

      it("should emit the required events", async () => {
        await expect(tx).to.emit(cashbackVault, "CashbackGranted")
          .withArgs(
            payer.address,
            getAddress(context.cardPaymentProcessorShell.cashbackControllerContract),
            cashbackAmount,
            cashbackAmount,
          );
        await expect(tx).to.emit(cardPaymentProcessorShell.cashbackControllerContract, EVENT_NAME_CASHBACK_SENT)
          .withArgs(
            payment.id,
            payer.address,
            CashbackOperationStatus.Success,
            cashbackAmount,
          );
      });

      describe("Refunding part of the payment", () => {
        let tx: Promise<TransactionResponse>;
        let cashbackRemaining: number;
        let cashbackRefunded: number;

        beforeEach(async () => {
          tx = (await cardPaymentProcessorShell.refundPayment(payment, 100 * DIGITS_COEF)).tx;
          cashbackRemaining =
            cardPaymentProcessorShell.model.getCashbackTotalForAccount(payer.address);
          cashbackRefunded = cashbackAmount - cashbackRemaining;
        });

        it("should transfer tokens from cashback vault to treasury", async () => {
          await expect(tx).to.changeTokenBalances(tokenMock,
            [getAddress(cashbackVault), context.cashbackTreasury.address],
            [-cashbackRefunded, cashbackRefunded]);
        });

        it("should emit required cashback events", async () => {
          await expect(tx).to.emit(cashbackVault, "CashbackRevoked")
            .withArgs(
              payer.address,
              getAddress(context.cardPaymentProcessorShell.cashbackControllerContract),
              cashbackRefunded,
              cashbackRemaining,
            );

          await expect(tx).to.emit(cardPaymentProcessorShell.cashbackControllerContract, EVENT_NAME_CASHBACK_DECREASED)
            .withArgs(
              payment.id,
              payer.address,
              CashbackOperationStatus.Success,
              cashbackRefunded,
              cashbackRemaining,
            );
        });

        describe("Claiming all cashback", () => {
          let tx: TransactionResponse;
          beforeEach(async () => {
            tx = await cashbackVault.claim(payer.address, cashbackRemaining);
          });

          it("should transfer tokens from vault to payer", async () => {
            await expect(tx).to.changeTokenBalances(tokenMock,
              [getAddress(cashbackVault), payer.address],
              [-cashbackRemaining, cashbackRemaining]);
          });

          it("should emit required cashback events", async () => {
            await expect(tx).to.emit(cashbackVault, "CashbackClaimed")
              .withArgs(
                payer.address,
                deployer.address,
                cashbackRemaining,
                0,
              );
          });
        });
      });

      describe("Claiming part of the cashback", () => {
        let tx: TransactionResponse;
        let cashbackClaimed: number;

        beforeEach(async () => {
          cashbackClaimed = Math.floor(cashbackAmount / 2);
          tx = await cashbackVault.claim(payer.address, cashbackAmount / 2);
        });

        it("should transfer tokens from vault to payer", async () => {
          await expect(tx).to.changeTokenBalances(tokenMock,
            [getAddress(cashbackVault), payer.address],
            [-cashbackClaimed, cashbackClaimed]);
        });

        describe("Revocation of the payment", () => {
          let tx: Promise<TransactionResponse>;
          beforeEach(async () => {
            tx = (await cardPaymentProcessorShell.revokePayment(payment)).tx;
          });

          it("should transfer cashback from cashback vault and account balance to treasury", async () => {
            const paymentModel = cardPaymentProcessorShell.model.getPaymentById(payment.id);
            await expect(tx).to.changeTokenBalances(tokenMock,
              [getAddress(cashbackVault), context.cashbackTreasury.address, payer.address],
              [
                -(cashbackAmount - cashbackClaimed),
                cashbackAmount,
                paymentModel.baseAmount + paymentModel.extraAmount - cashbackClaimed,
              ],
            );
          });
        });
      });
    });
  });

  describe("Snapshot scenarios", () => {
    it("Common usage of CPP with CC and CV", async () => {
      const context = await beforeMakingPayments();
      const cardPaymentProcessorShell = context.cardPaymentProcessorShell;
      const tokenMock = context.tokenMock as unknown as Contracts.ERC20TokenMock;

      const cashbackVaultFactory = await ethers.getContractFactory("CashbackVault");
      const cashbackVault = await upgrades.deployProxy(cashbackVaultFactory, [getAddress(context.tokenMock)]);
      await cashbackVault.waitForDeployment();
      await expect.startChainshot({
        accounts: {
          payer: context.payments[0].payer.address,
          deployer: deployer.address,
          executor: executor.address,
          sponsor: sponsor.address,
          cashbackTreasury: context.cashbackTreasury.address,
          cashOutAccount: context.cashOutAccount.address,
        },
        contracts: {
          CPP: cardPaymentProcessorShell.contract,
          cashbackVault,
          cashbackController: cardPaymentProcessorShell.cashbackControllerContract,
        },
        tokens: {
          BRLC: tokenMock,
        },
      });
      await cashbackVault.grantRole(GRANTOR_ROLE, deployer.address);
      await cashbackVault.grantRole(
        CASHBACK_OPERATOR_ROLE,
        getAddress(cardPaymentProcessorShell.cashbackControllerContract),
      );
      await cashbackVault.grantRole(MANAGER_ROLE, deployer.address);
      await cardPaymentProcessorShell.cashbackControllerContract.setCashbackVault(getAddress(cashbackVault));
      const payment = {
        ...context.payments[0],
        baseAmount: 10000 * DIGITS_COEF,
        extraAmount: 4000 * DIGITS_COEF,
        cashbackRate: 100,
      };
      const payer = payment.payer;

      await cardPaymentProcessorShell.makePaymentFor(payment);
      await cardPaymentProcessorShell.refundPayment(payment, 100 * DIGITS_COEF);
      await cashbackVault.claim(payer.address, 1 * DIGITS_COEF);
      await cardPaymentProcessorShell.revokePayment(payment);
      await expect.stopChainshot();
    });
  });
});
