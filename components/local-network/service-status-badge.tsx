import { Badge } from "@/components/ui/badge";
import { CheckCircle2Icon, MinusCircleIcon } from "lucide-react";

export function ServiceStatusBadge({
  status,
  installed = true,
}: {
  status: string;
  installed?: boolean;
}) {
  if (status === "running") {
    return (
      <Badge
        variant="outline"
        className="border-success/30 bg-success/10 text-success"
      >
        <CheckCircle2Icon className="h-3 w-3" />
        Active
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-muted-foreground/30 bg-muted/50 text-muted-foreground"
    >
      <MinusCircleIcon className="h-3 w-3" />
      {installed ? "Inactive" : "Not Installed"}
    </Badge>
  );
}
