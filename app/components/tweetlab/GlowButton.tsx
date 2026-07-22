import { cn } from "@agent-native/core/client";

// Monochrome twin of the amber 3D glossy button: blur glow + metallic gradient,
// hard bottom edge, active press. Grayscale only.
export function GlowButton({
  children,
  icon,
  className,
  disabled,
  block,
  size = "md",
  type = "button",
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  block?: boolean;
  size?: "sm" | "md";
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group/btn relative shrink-0 disabled:cursor-not-allowed disabled:opacity-60",
        block && "w-full",
        className,
      )}
    >
      <div className="absolute -inset-1 rounded-xl bg-[hsl(16_76%_43%)]/45 opacity-50 blur transition duration-500 group-hover/btn:opacity-90" />
      <div
        className={cn(
          "relative flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-gradient-to-b from-zinc-100 via-zinc-300 to-zinc-500 font-medium tracking-tight text-zinc-900 shadow-[0_0_0_1px_rgba(161,161,170,0.5),0_4px_0_#52525b,0_10px_15px_-3px_rgba(0,0,0,0.5)] transition-all duration-150 active:translate-y-[2px] active:shadow-[0_0_0_1px_rgba(161,161,170,0.5),0_2px_0_#52525b]",
          size === "sm" ? "px-4 py-2 text-sm" : "px-5 py-2.5 text-sm",
          block && "w-full",
        )}
      >
        <span>{children}</span>
        {icon}
      </div>
    </button>
  );
}
