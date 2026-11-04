// =============================================================================
// sms-threads — view models for the thread list, plus the geometry constants
// the skeleton mirrors
// =============================================================================
// One place builds the list the left pane renders, so the conversation, the
// unread counts and the search filter can never disagree about what a thread
// is. The backend's `threads[]` is preferred when present; when it is missing
// (or a message has no thread entry) the same shape is derived by grouping
// `messages[]` on the RAW stored address.
// =============================================================================

import type { SmsData } from "@/hooks/use-sms";
import type { SmsMessage, SmsThread } from "@/types/sms";

import { isOutbound, smsEpochMs } from "./sms-format";
import { resolveSmsIdentity, type SmsIdentity } from "./sms-identity";

// -----------------------------------------------------------------------------
// Shared geometry: The Skeleton-Mirror Rule
// -----------------------------------------------------------------------------
// The loading skeleton imports these rather than restating numbers, so a change
// to the row's padding or disc size cannot leave the two out of step.

/** Outer frame of one thread row: padding, radius and the 12px column gap. */
export const THREAD_ROW_FRAME = "flex items-start gap-3 rounded-tile p-3";
/** The identity disc. 40px on desktop, 42px once the list is the whole pane. */
export const THREAD_DISC_SIZE = "size-10 @sm/list:size-[2.625rem]";
/** Vertical rhythm between rows. */
export const THREAD_LIST_GAP = "gap-0.5";

export interface SmsThreadView {
  /**
   * THE KEY. The raw stored address: React key, route parameter, fetch key,
   * delete key, reply destination. Never a display name.
   */
  addr: string;
  identity: SmsIdentity;
  /** One-line preview of the newest message in the thread. */
  preview: string;
  /** True when the newest message was sent from this device ("You: ..."). */
  previewOutbound: boolean;
  /** Newest message time, epoch ms. 0 when unparseable. */
  epochMs: number;
  /** Unread count to render in the pill. 0 hides it. */
  unread: number;
  /** Every message filed under this address, newest last. */
  messages: SmsMessage[];
}

function identityFrom(source: SmsThread | SmsMessage, addr: string): SmsIdentity {
  return resolveSmsIdentity(addr, {
    display_name: source.display_name,
    display_source: source.display_source,
    addr_kind: source.addr_kind,
  });
}

/**
 * Build the thread list.
 *
 * Unread comes from the hook's client-side overlay (`useSms` stamps `unread` on
 * received messages this browser has not opened and rolls the count onto each
 * thread's `unreadCount`). A thread only reachable through the flat
 * `messages[]` (no `threads[]` entry) falls back to counting its messages whose
 * `unread` field is truthy.
 */
export function buildThreadViews(data: SmsData | null): SmsThreadView[] {
  if (!data) return [];

  // Group every message by the RAW stored address it is filed under.
  const byAddr = new Map<string, SmsMessage[]>();
  for (const msg of data.messages) {
    const addr = msg.addr || msg.sender;
    if (!addr) continue;
    const bucket = byAddr.get(addr);
    if (bucket) bucket.push(msg);
    else byAddr.set(addr, [msg]);
  }
  for (const bucket of byAddr.values()) {
    bucket.sort((a, b) => smsEpochMs(a) - smsEpochMs(b));
  }

  const views: SmsThreadView[] = [];
  const seen = new Set<string>();

  const push = (addr: string, source: SmsThread | SmsMessage, thread?: SmsThread) => {
    if (seen.has(addr)) return;
    seen.add(addr);

    const messages = byAddr.get(addr) ?? [];
    const newest = messages[messages.length - 1];

    const unread = thread
      ? (thread.unreadCount ?? 0)
      : messages.reduce((n, m) => (m.unread ? n + 1 : n), 0);

    const previewSource =
      thread?.latestMessage ?? thread?.content ?? newest?.content ?? "";
    const previewOutbound = thread
      ? thread.direction === "outbound" || thread.type === 0
      : newest
        ? isOutbound(newest)
        : false;

    const epochMs = thread?.timestampSec
      ? thread.timestampSec * 1000
      : thread?.timestamp
        ? smsEpochMs({ timestamp: thread.timestamp })
        : newest
          ? smsEpochMs(newest)
          : 0;

    views.push({
      addr,
      identity: identityFrom(source, addr),
      preview: previewSource,
      previewOutbound,
      epochMs,
      unread,
      messages,
    });
  };

  for (const thread of data.threads) {
    if (!thread.addr) continue;
    push(thread.addr, thread, thread);
  }
  // Anything present in the flat list but absent from `threads[]` still gets a
  // row: a message the user can see in the inbox must be reachable.
  for (const [addr, bucket] of byAddr) {
    const newest = bucket[bucket.length - 1];
    if (newest) push(addr, newest);
  }

  return views.sort((a, b) => b.epochMs - a.epochMs);
}

/**
 * Build a view for a thread the LIST does not know about, straight from the
 * thread-detail response. Identity is read off the first message, while `addr`
 * stays the raw key the caller already holds.
 */
export function threadViewFromMessages(
  addr: string,
  messages: SmsMessage[],
): SmsThreadView {
  const ordered = [...messages].sort((a, b) => smsEpochMs(a) - smsEpochMs(b));
  const newest = ordered[ordered.length - 1];
  const identitySource = ordered[0];

  return {
    addr,
    identity: identitySource
      ? identityFrom(identitySource, addr)
      : resolveSmsIdentity(addr),
    preview: newest?.content ?? "",
    previewOutbound: newest ? isOutbound(newest) : false,
    epochMs: newest ? smsEpochMs(newest) : 0,
    unread: 0,
    messages: ordered,
  };
}

/** Case-insensitive match across the resolved title, the raw address and bodies. */
export function threadMatchesQuery(view: SmsThreadView, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (view.identity.title.toLowerCase().includes(q)) return true;
  if (view.addr.toLowerCase().includes(q)) return true;
  if (view.identity.formattedAddr.toLowerCase().includes(q)) return true;
  return view.messages.some((m) => m.content?.toLowerCase().includes(q));
}
