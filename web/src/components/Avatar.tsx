"use client";

/**
 * 头像组件 — 支持文字头像和图片头像
 * 颜色由名字 hash 决定，保证同一用户颜色一致
 */
const AVATAR_COLORS = [
  "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-pink-500",
  "bg-indigo-500", "bg-yellow-500", "bg-red-500", "bg-teal-500",
];

const SIZE_MAP = {
  sm: "w-6 h-6 text-xs",
  md: "w-8 h-8 text-sm",
  lg: "w-14 h-14 text-xl",
  xl: "w-20 h-20 text-3xl",
} as const;

function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

interface AvatarProps {
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  avatarUrl?: string;
}

/**
 * 头像组件 — 有图片用图片，没图片取名字首字 + hash 颜色
 */
export default function Avatar({ name, size = "sm", avatarUrl }: AvatarProps) {
  const colorClass = AVATAR_COLORS[nameHash(name) % AVATAR_COLORS.length];
  const sizeClass = SIZE_MAP[size] || SIZE_MAP.sm;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0`}
      />
    );
  }

  return (
    <div className={`${colorClass} ${sizeClass} rounded-full flex items-center justify-center text-white font-medium flex-shrink-0`}>
      {name.charAt(0)}
    </div>
  );
}
