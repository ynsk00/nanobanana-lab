"use client";

import React from "react";

export function Button({
  children,
  className = "",
  variant = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5";
  const variants: Record<string, string> = {
    default: "bg-zinc-800 hover:bg-zinc-700 text-zinc-100",
    primary:
      "bg-amber-400 hover:bg-amber-300 text-zinc-900 shadow shadow-amber-500/20",
    ghost: "bg-transparent hover:bg-zinc-800 text-zinc-300",
    danger: "bg-transparent hover:bg-red-500/15 text-red-400",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-zinc-800 bg-zinc-900/40 ${className}`}
    >
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          {title}
        </h2>
        {right}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}
