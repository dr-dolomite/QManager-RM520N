import { Badge } from "@/components/ui/badge";

export function SignalBadge({ strength }: { strength: number }) {
  if (strength >= -85)
    return (
      <Badge className="bg-success/15 text-success hover:bg-success/20 border-success/30">
        Good
      </Badge>
    );
  if (strength >= -100)
    return (
      <Badge className="bg-warning/15 text-warning hover:bg-warning/20 border-warning/30">
        Fair
      </Badge>
    );
  return (
    <Badge className="bg-destructive/15 text-destructive hover:bg-destructive/20 border-destructive/30">
      Bad
    </Badge>
  );
}

export function NetworkTypeBadge({ type }: { type: string }) {
  return <Badge variant="default">{type}</Badge>;
}
