import { LayoutGrid } from "lucide-react";

export function ChannelIcon({ label }: { label: string }) {
  if (label === "Shopify") return <ShopifyIcon />;
  if (label === "Amazon") return <AmazonIcon />;
  return <AllChannelsIcon />;
}

function AllChannelsIcon() {
  return <LayoutGrid size={18} className="text-muted-foreground shrink-0" />;
}

function ShopifyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      {/* bag body */}
      <path
        d="M17.5 9H16A4 4 0 0 0 8 9H6.5L5 22H19L17.5 9Z"
        fill="#96BF48"
      />
      {/* handle arch */}
      <path
        d="M9.5 9a2.5 2.5 0 0 1 5 0"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* S-notch */}
      <path
        d="M10.5 14.5c0-.8.6-1 1.5-1s1.5.5 1.5 1.2-.7 1-1.5 1.1-1.5.5-1.5 1.3.7 1.2 1.5 1.2 1.5-.3 1.5-1"
        stroke="white"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function AmazonIcon() {
  return (
    <svg width="20" height="18" viewBox="0 0 28 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      {/* wordmark "a" — simplified */}
      <text
        x="14"
        y="15"
        textAnchor="middle"
        fontFamily="'Georgia', serif"
        fontWeight="bold"
        fontSize="16"
        fill="#232F3E"
      >
        a
      </text>
      {/* smile arc */}
      <path
        d="M7 19.5 Q14 23.5 21 19.5"
        stroke="#FF9900"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
      {/* arrow tip */}
      <path
        d="M20 18.5 L21.5 19.5 L20.5 21"
        stroke="#FF9900"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
