"use client";

import { type ExchangeRate, type ModelPrice } from "./price-types";

interface PriceCellProps {
  value: number;
  row: ModelPrice;
  exchangeRate: ExchangeRate | null;
}

export default function PriceCell({ value, row, exchangeRate }: PriceCellProps) {
  const isUSD = row.channelCurrency === "USD" || row.currency === "USD";
  if (isUSD && exchangeRate) {
    return (
      <div className="text-right">
        <div className="text-gray-700">${value.toFixed(4)}</div>
        <div className="text-[10px] text-gray-400">约 ¥{(value * exchangeRate.rate).toFixed(4)}</div>
      </div>
    );
  }

  return <div className="text-right text-gray-700">¥{value.toFixed(4)}</div>;
}
