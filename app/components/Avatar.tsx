interface AvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizes = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-16 w-16 text-xl", xl: "h-32 w-32 text-4xl" };

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function Avatar({ name, photoUrl, size = "md" }: AvatarProps) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={`${name} profile photo`}
        className={`${sizes[size]} rounded-full object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <span
      aria-label={`${name} initials avatar`}
      className={`${sizes[size]} rounded-full bg-indigo-100 text-indigo-600 font-semibold
        flex items-center justify-center flex-shrink-0`}
    >
      {initials(name)}
    </span>
  );
}
