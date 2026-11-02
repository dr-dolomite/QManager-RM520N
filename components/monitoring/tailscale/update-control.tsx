"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CircleArrowUpIcon, Loader2Icon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { TailscaleActionResult } from "@/hooks/use-tailscale";

/** The update offer on the Version row; confirmed first, since the tunnel drops
 *  for a few seconds while tailscaled restarts. */
export function UpdateControl({
  latestVersion,
  updating,
  disabled,
  runUpdate,
}: {
  latestVersion: string;
  updating: boolean;
  disabled: boolean;
  runUpdate: () => Promise<TailscaleActionResult>;
}) {
  const { t } = useTranslation("common");

  const handleUpdate = async () => {
    // Read before the await: the status is replaced once the update lands.
    const target = latestVersion;
    const result = await runUpdate();
    if (result.ok) {
      toast.success(
        t("tailscale.toast.updated", { version: result.version || target }),
      );
    } else {
      toast.error(t("tailscale.toast.updateFailed"), {
        description: result.reason || undefined,
      });
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="tonal"
          size="xs"
          disabled={disabled || updating}
        >
          {updating ? (
            <Loader2Icon className="size-3 motion-safe:animate-spin" />
          ) : (
            <CircleArrowUpIcon className="size-3" />
          )}
          {updating
            ? t("tailscale.connection.updating")
            : t("tailscale.connection.updateAvailable", {
                version: latestVersion,
              })}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("tailscale.connection.updateDialogTitle", {
              version: latestVersion,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("tailscale.connection.updateDialogDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("tailscale.actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void handleUpdate()}>
            {t("tailscale.connection.update")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
