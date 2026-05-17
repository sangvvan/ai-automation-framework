import type { HTMLAttributes } from "react";

type Variant = "green" | "amber" | "red" | "blue" | "gray";

const styles: Record<Variant, string> = {
  green: "bg-green-100 text-green-700",
  amber: "bg-amber-100 text-amber-700",
  red:   "bg-red-100   text-red-700",
  blue:  "bg-blue-100  text-blue-700",
  gray:  "bg-gray-100  text-gray-600",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({ variant = "gray", className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium
        ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
