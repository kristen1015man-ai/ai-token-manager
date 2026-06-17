"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export interface GlassSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface GlassSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: GlassSelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * GlassSelect — 毛玻璃风格自定义下拉组件
 * 替代原生 <select>，提供统一的视觉体验
 */
export default function GlassSelect({
  value,
  onChange,
  options,
  placeholder = "请选择",
  className = "",
  disabled = false,
}: GlassSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 点击外部关闭
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // 打开时滚动到选中项
  useEffect(() => {
    if (open && listRef.current) {
      const idx = options.findIndex((o) => o.value === value);
      if (idx >= 0) {
        const item = listRef.current.children[idx] as HTMLElement;
        item?.scrollIntoView({ block: "nearest" });
      }
    }
  }, [open, options, value]);

  const selected = options.find((o) => o.value === value);

  const handleSelect = useCallback(
    (opt: GlassSelectOption) => {
      if (opt.disabled) return;
      onChange(opt.value);
      setOpen(false);
    },
    [onChange]
  );

  return (
    <div
      ref={containerRef}
      className={`glass-select-wrap ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className}`}
    >
      {/* 触发器 */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        className={`glass-select-trigger ${open ? "glass-select-trigger-open" : ""}`}
      >
        <span className={`truncate ${!selected ? "text-gray-400" : ""}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className={`glass-select-chevron ${open ? "rotate-180" : ""}`}
          width="14"
          height="8"
          viewBox="0 0 14 8"
          fill="none"
        >
          <path
            d="M1 1.5L7 6.5L13 1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* 下拉面板 */}
      {open && (
        <div className="glass-select-dropdown">
          <ul ref={listRef} className="glass-select-list">
            {options.map((opt) => (
              <li
                key={opt.value}
                className={`glass-select-item ${
                  opt.value === value
                    ? "glass-select-item-active"
                    : ""
                } ${opt.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                onClick={() => handleSelect(opt)}
                role="option"
                aria-selected={opt.value === value}
              >
                {opt.value === value && (
                  <svg
                    className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
                <span>{opt.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
