"use client";

/** 价格管理页 — 价格单元格组件（支持双币种显示） */
import { type ModelPrice, type ExchangeRate } from "./price-types";

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
        <div className="text-gray-700">${value}</div>
        <div className="text-[10px] text-gray-400">≈ ¥{(value * exchangeRate.rate).toFixed(2)}</div>
      </div>
    );
  }
  return <div className="text-right text-gray-700">¥{value}</div>;
}
