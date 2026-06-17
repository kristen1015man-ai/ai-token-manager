"use client";

import { useState, useRef, useEffect } from "react";
import { type AdminOption } from "../app/dashboard/admin/alerts/alert-types";

interface AdminMultiSelectProps {
  /** 可选管理员列表 */
  admins: AdminOption[];
  /** 已选中的 user ID 数组 */
  selected: string[];
  /** 选择变更回调 */
  onChange: (selected: string[]) => void;
  /** 占位文本 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
}

/**
 * 管理员多选下拉组件
 *
 * - 点击展开下拉列表
 * - 每个管理员带 checkbox 可勾选
 * - 选中的管理员显示为 tag
 * - 空选择 = 通知所有管理员（显示提示文字）
 */
export default function AdminMultiSelect({
  admins,
  selected,
  onChange,
  placeholder = "选择接收通知的管理员",
  disabled = false,
}: AdminMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggleAdmin = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const removeAdmin = (id: string) => {
    onChange(selected.filter((s) => s !== id));
  };

  const selectedAdmins = admins.filter((a) => selected.includes(a.id));

  return (
    <div ref={containerRef} className="relative">
      {/* 触发器 */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`w-full min-h-[38px] px-3 py-2 text-left rounded-xl border transition-colors text-sm ${
          disabled
            ? "bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed"
            : open
            ? "bg-white border-indigo-300 ring-1 ring-indigo-100"
            : "bg-white border-gray-200 hover:border-gray-300"
        }`}
      >
        {selectedAdmins.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {selectedAdmins.map((admin) => (
              <span
                key={admin.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-md text-xs"
              >
                {admin.name}
                {!disabled && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAdmin(admin.id);
                    }}
                    className="cursor-pointer hover:text-indigo-800"
                  >
                    ×
                  </span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-gray-400">
            {placeholder}（空 = 通知所有管理员）
          </span>
        )}
      </button>

      {/* 下拉列表 */}
      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
          {admins.length === 0 ? (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">
              暂无可选管理员
            </div>
          ) : (
            admins.map((admin) => {
              const isSelected = selected.includes(admin.id);
              return (
                <label
                  key={admin.id}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors ${
                    isSelected ? "bg-indigo-50/50" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleAdmin(admin.id)}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 truncate">{admin.name}</p>
                    {admin.department && (
                      <p className="text-xs text-gray-400 truncate">{admin.department}</p>
                    )}
                  </div>
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
