"use client";

import { Fragment } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { AmbrData } from "@/types/cellular-settings";
import { formatBitrate } from "@/types/cellular-settings";
import { MaterialSymbol } from "@/components/ui/material-symbol";

interface CellularAMBRCardProps {
  ambr: AmbrData | null;
  isLoading: boolean;
}

const CellularAMBRCard = ({ ambr, isLoading }: CellularAMBRCardProps) => {
  if (isLoading) {
    return (
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>Data Rate Limits</CardTitle>
          <CardDescription>
            The maximum upload and download speeds your carrier allows for each
            data connection. These limits are set by your carrier&apos;s network policy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-y-6">
            <div className="grid gap-2">
              <Skeleton className="h-4 w-20" />
              <Separator />
              <Skeleton className="h-6 w-full" />
              <Separator />
              <Skeleton className="h-6 w-full" />
              <Separator />
            </div>
            <div className="grid gap-2">
              <Skeleton className="h-4 w-24" />
              <Separator />
              <Skeleton className="h-6 w-full" />
              <Separator />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Data Rate Limits</CardTitle>
        <CardDescription>
          The maximum upload and download speeds your carrier allows for each
          data connection. These limits are set by your carrier&apos;s network policy.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-y-6">
          {/* LTE AMBR Section */}
          <div className="grid gap-2">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex" aria-label="More info">
                    <MaterialSymbol name="info" filled size={20} className="text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    While devices can request specific AMBR values, operators{" "}
                    <br />
                    may ignore these and enforce their own speed limits based on{" "}
                    <br />
                    subscription plans, network policies, or congestion
                    conditions.
                  </p>
                </TooltipContent>
              </Tooltip>
              <h2 className="font-semibold text-sm">LTE Rates</h2>
            </div>

            <Separator />
            {ambr && ambr.lte.length > 0 ? (
              ambr.lte.map((entry, index) => (
                <Fragment key={`lte-${index}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-muted-foreground text-sm">
                      {entry.apn}
                    </p>
                    <div className="flex items-center gap-x-4">
                      <div className="flex items-center gap-x-1">
                        <MaterialSymbol name="arrow_circle_down" size={16} className="text-info" />
                        <p className="font-semibold text-sm">
                          {formatBitrate(entry.dl_kbps)}
                        </p>
                      </div>
                      <div className="flex items-center gap-x-1">
                        <MaterialSymbol name="arrow_circle_up" size={16} className="text-info" />
                        <p className="font-semibold text-sm">
                          {formatBitrate(entry.ul_kbps)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <Separator />
                </Fragment>
              ))
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  No LTE rate data available
                </p>
                <Separator />
              </>
            )}
          </div>

          {/* NR5G AMBR Section */}
          <div className="grid gap-2">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex" aria-label="More info">
                    <MaterialSymbol name="info" filled size={20} className="text-info" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    While devices can request specific AMBR values, operators{" "}
                    <br />
                    may ignore these and enforce their own speed limits based on{" "}
                    <br />
                    subscription plans, network policies, or congestion
                    conditions.
                  </p>
                </TooltipContent>
              </Tooltip>
              <h2 className="font-semibold text-sm">5G Rates</h2>
            </div>
            <Separator />
            {ambr && ambr.nr5g.length > 0 ? (
              ambr.nr5g.map((entry, index) => (
                <Fragment key={`nr5g-${index}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-muted-foreground text-sm">
                      {entry.dnn}
                    </p>
                    <div className="flex items-center gap-x-4">
                      <div className="flex items-center gap-x-1">
                        <MaterialSymbol name="arrow_circle_down" size={16} className="text-info" />
                        <p className="font-semibold text-sm">
                          {formatBitrate(entry.dl_kbps)}
                        </p>
                      </div>
                      <div className="flex items-center gap-x-1">
                        <MaterialSymbol name="arrow_circle_up" size={16} className="text-info" />
                        <p className="font-semibold text-sm">
                          {formatBitrate(entry.ul_kbps)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <Separator />
                </Fragment>
              ))
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  No 5G rate data available
                </p>
                <Separator />
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default CellularAMBRCard;
