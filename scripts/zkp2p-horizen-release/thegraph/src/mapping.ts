import { Bytes } from "@graphprotocol/graph-ts";
import {
  Deposited,
  IntentReserved,
  Released
} from "../generated/Zkp2pDepositPool/Zkp2pDepositPool";
import { Commitment, DepositEvent, ReleaseEvent } from "../generated/schema";

function eventId(txHash: Bytes, logIndex: i32): string {
  return txHash.toHexString() + "-" + logIndex.toString();
}

export function handleDeposited(event: Deposited): void {
  const id = eventId(event.transaction.hash, event.logIndex.toI32());
  const item = new DepositEvent(id);
  item.seller = event.params.seller;
  item.amount = event.params.amount;
  item.txHash = event.transaction.hash;
  item.blockNumber = event.block.number;
  item.createdAt = event.block.timestamp;
  item.save();
}

export function handleIntentReserved(event: IntentReserved): void {
  const id = event.params.intentId.toHexString();
  const commitment = new Commitment(id);
  commitment.intentId = event.params.intentId;
  commitment.buyer = event.params.buyer;
  commitment.amount = event.params.amount;
  commitment.txHash = event.transaction.hash;
  commitment.blockNumber = event.block.number;
  commitment.createdAt = event.block.timestamp;
  commitment.save();
}

export function handleReleased(event: Released): void {
  const id = eventId(event.transaction.hash, event.logIndex.toI32());
  const item = new ReleaseEvent(id);
  item.intentId = event.params.intentId;
  item.buyer = event.params.buyer;
  item.amount = event.params.amount;
  item.nullifierHash = event.params.nullifierHash;
  item.txHash = event.transaction.hash;
  item.blockNumber = event.block.number;
  item.createdAt = event.block.timestamp;
  item.save();
}
