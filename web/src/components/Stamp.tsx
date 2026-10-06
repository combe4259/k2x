type Verdict = "accepted" | "held" | "rejected";

const STYLE: Record<Verdict, string> = {
  accepted: "text-accepted border-accepted",
  held: "text-held border-held border-dashed",
  rejected: "text-rejected border-rejected -rotate-3",
};

const WORD: Record<Verdict, string> = { accepted: "Trusted", held: "Held", rejected: "Rejected" };

/** The engine's verdict, set like a rubber stamp on the print it judged. */
export function Stamp({ verdict, small = false }: { verdict: Verdict; small?: boolean }) {
  return (
    <span
      className={`display inline-block border-2 font-semibold uppercase leading-none ${STYLE[verdict]} ${
        small ? "rounded-[3px] px-1.5 py-[3px] text-[10px] tracking-[0.08em]" : "rounded-[4px] px-2 py-1 text-xs tracking-[0.1em]"
      }`}
    >
      {WORD[verdict]}
    </span>
  );
}
