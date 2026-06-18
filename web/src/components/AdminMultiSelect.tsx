"use client";

import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import Avatar from "@/components/Avatar";
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
  const visibleSelectedAdmins = selectedAdmins.slice(0, 3);
  const hiddenSelectedCount = Math.max(0, selectedAdmins.length - visibleSelectedAdmins.length);

  return (
    <div ref={containerRef} className="relative">
      {/* 触发器 */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`w-full min-h-[44px] px-3 py-2 text-left rounded-xl border transition-all text-sm ${
          disabled
            ? "bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed"
            : open
            ? "bg-white border-rose-300 ring-2 ring-rose-100 shadow-sm"
            : "bg-white border-gray-200 hover:border-rose-200 hover:shadow-sm"
        }`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1">
            {selectedAdmins.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1.5">
                {visibleSelectedAdmins.map((admin) => (
                  <span
                    key={admin.id}
                    className="inline-flex max-w-[150px] items-center gap-1.5 rounded-full border border-rose-100 bg-rose-50/80 px-1.5 py-1 text-xs text-rose-700"
                  >
                    <Avatar name={admin.name} size="sm" avatarUrl={admin.avatar ?? undefined} />
                    <span className="truncate">{admin.name}</span>
                    {!disabled && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAdmin(admin.id);
                        }}
                        className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full hover:bg-rose-100 hover:text-rose-900"
                        aria-label={`移除 ${admin.name}`}
                      >
                        <X className="h-3 w-3" />
                      </span>
                    )}
                  </span>
                ))}
                {hiddenSelectedCount > 0 && (
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500">
                    +{hiddenSelectedCount}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-gray-400">
                {placeholder}（空 = 通知所有管理员）
              </span>
            )}
          </span>
          <ChevronDown
            className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
      </button>

      {/* 下拉列表 */}
      {open && !disabled && (
        <div className="absolute left-0 right-0 z-[80] mt-2 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl shadow-rose-100/40">
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
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-rose-50/70 ${
                    isSelected ? "bg-rose-50/80" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleAdmin(admin.id)}
                    className="h-4 w-4 rounded border-gray-300 text-rose-600 focus:ring-rose-500"
                  />
                  <Avatar name={admin.name} size="sm" avatarUrl={admin.avatar ?? undefined} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-gray-700">{admin.name}</p>
                    {admin.department && (
                      <p className="text-xs text-gray-400 truncate">{admin.department}</p>
                    )}
                  </div>
                  {isSelected && <Check className="h-4 w-4 flex-shrink-0 text-rose-500" />}
                </label>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
