"use client";

import { useState, useMemo } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

export interface PingEntry {
  timestamp: number;
  latency: number;
  packet_loss: number;
  ok: boolean;
}

type SortOrder = "newest" | "oldest";

interface PingEntriesCardProps {
  entries: PingEntry[];
  emptyMessage: string;
  isRealtime: boolean;
}

// =============================================================================
// Component
// =============================================================================

const PingEntriesCard = ({
  entries,
  emptyMessage,
  isRealtime,
}: PingEntriesCardProps) => {
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  const sortedEntries = useMemo(
    () => (sortOrder === "newest" ? entries.toReversed() : entries),
    [entries, sortOrder],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Detailed Entries</CardTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1">
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span className="sr-only sm:not-sr-only sm:whitespace-nowrap">
                  Sort
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={sortOrder === "newest"}
                onCheckedChange={() => setSortOrder("newest")}
              >
                Newest first
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortOrder === "oldest"}
                onCheckedChange={() => setSortOrder("oldest")}
              >
                Oldest first
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CardDescription>
          Individual ping results for the selected time range.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Latency</TableHead>
              <TableHead>Packet Loss</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedEntries.length > 0 ? (
              sortedEntries.map((ping) => (
                <TableRow key={ping.timestamp}>
                  <TableCell>
                    {isRealtime && !ping.ok
                      ? "Timeout"
                      : `${ping.latency} ms`}
                  </TableCell>
                  <TableCell>{ping.packet_loss}%</TableCell>
                  <TableCell>
                    {new Date(ping.timestamp).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell>
                    {new Date(ping.timestamp).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="text-center">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default PingEntriesCard;
