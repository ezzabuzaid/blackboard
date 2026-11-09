import {
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@zukhruf/shadcn';
import {
  Bot,
  Braces,
  ExternalLink,
  Lightbulb,
  MessageSquareText,
  Wrench,
} from 'lucide-react';
import {
  type PropsWithChildren,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';

import { useGroupChat } from '../GroupChat.tsx';
import {
  type AgentTraceItem,
  type AgentTraceTurn,
  fetchAgentTraces,
  traceItems,
} from './agentTrace.ts';

interface AgentTraceSelection {
  agent: string | null;
  select(name: string): void;
  close(): void;
}

const AgentTraceContext = createContext<AgentTraceSelection | null>(null);

export function AgentTraceProvider({ children }: PropsWithChildren) {
  const [agent, setAgent] = useState<string | null>(null);
  return (
    <AgentTraceContext
      value={{ agent, select: setAgent, close: () => setAgent(null) }}
    >
      {children}
    </AgentTraceContext>
  );
}

export function useAgentTraceSelection() {
  const selection = useContext(AgentTraceContext);
  if (!selection) throw new Error('Agent trace selection is missing');
  return selection;
}

export function useOptionalAgentTraceSelection() {
  return useContext(AgentTraceContext);
}

export function AgentTraceSidebar() {
  const { agent, close } = useAgentTraceSelection();

  return (
    <Sheet open={agent !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent className="w-[min(92vw,38rem)] gap-0 p-0 data-[side=right]:sm:max-w-[38rem]">
        <TraceHeader />
        <TraceList />
      </SheetContent>
    </Sheet>
  );
}

function TraceHeader() {
  const { agent } = useAgentTraceSelection();
  const { activity } = useGroupChat();
  const operationalState = activity.participants.find(
    ({ name }) => name === agent,
  )?.state;
  return (
    <SheetHeader className="border-b px-5 py-4 pr-14">
      <div className="flex items-center gap-2">
        <SheetTitle>{agent ?? 'Agent'} traces</SheetTitle>
        {operationalState && (
          <Badge variant="outline" className="capitalize">
            {operationalState.replace('-', ' ')}
          </Badge>
        )}
      </div>
      <SheetDescription>
        Private model steps, tools, outputs, and cache usage
      </SheetDescription>
    </SheetHeader>
  );
}

function TraceList() {
  const { turns, loading, error } = useData();
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-5 py-4">
        {loading && turns.length === 0 && (
          <p className="text-muted-foreground text-sm">Loading traces…</p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        {!loading && !error && turns.length === 0 && (
          <p className="text-muted-foreground text-sm">
            This agent has not received a notification in this chat yet.
          </p>
        )}
        <div className="divide-y">
          {[...turns].reverse().map((turn, index) => (
            <TraceTurn key={turn.callId} turn={turn} latest={index === 0} />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

function useData() {
  const { agent } = useAgentTraceSelection();
  const { activity, chatId } = useGroupChat();
  const [turns, setTurns] = useState<AgentTraceTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agent) {
      setTurns([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setTurns([]);
    setLoading(true);
    setError(null);
    void fetchAgentTraces(chatId, agent, controller.signal)
      .then(setTurns)
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : 'Agent traces failed.',
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [activity.phase, agent, chatId]);

  return { turns, loading, error };
}

function TraceTurn({
  turn,
  latest,
}: {
  turn: AgentTraceTurn;
  latest: boolean;
}) {
  const duration = turn.endedAt
    ? new Date(turn.endedAt).getTime() - new Date(turn.startedAt).getTime()
    : null;

  return (
    <Collapsible defaultOpen={latest} className="py-4">
      <CollapsibleTrigger className="flex w-full items-start justify-between gap-3 text-left">
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {formatTime(turn.startedAt)}
            </span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {turn.status}
            </Badge>
          </span>
          <span className="text-muted-foreground mt-1 block truncate font-mono text-[11px]">
            {turn.modelId}
          </span>
        </span>
        <span className="text-muted-foreground shrink-0 text-right text-[11px]">
          {duration !== null && <span>{formatDuration(duration)}</span>}
          <span className="block">
            {turn.usage.totalTokens.toLocaleString()} tokens
          </span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">
        <div className="space-y-0">
          {turn.notification && (
            <TimelineItem icon={<MessageSquareText />}>
              <Disclosure label="Notification input">
                <TraceText>{turn.notification}</TraceText>
              </Disclosure>
            </TimelineItem>
          )}
          {turn.steps.flatMap((step) =>
            traceItems(step.content).map((item, index) => (
              <TracePart key={`${step.stepNumber}-${index}`} item={item} />
            )),
          )}
          {turn.error && (
            <TimelineItem icon={<Braces />} last>
              <TraceText className="text-destructive">{turn.error}</TraceText>
            </TimelineItem>
          )}
          <TimelineItem icon={<Bot />} last>
            <div className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <span>Input {turn.usage.inputTokens.toLocaleString()}</span>
              <span>Output {turn.usage.outputTokens.toLocaleString()}</span>
              <span>Cached {turn.usage.cacheReadTokens.toLocaleString()}</span>
              <span>
                Reasoning {turn.usage.reasoningTokens.toLocaleString()}
              </span>
            </div>
          </TimelineItem>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TracePart({ item }: { item: AgentTraceItem }) {
  if (item.type === 'reasoning') {
    return (
      <TimelineItem icon={<Lightbulb />}>
        <Disclosure label="Reasoning">
          <TraceText>{item.text}</TraceText>
        </Disclosure>
      </TimelineItem>
    );
  }
  if (item.type === 'tool') {
    return (
      <TimelineItem icon={<Wrench />}>
        <Disclosure label={item.title ?? item.name} mono>
          <JsonBlock label="Input" value={item.input} />
          {item.output !== undefined && (
            <JsonBlock label="Output" value={item.output} />
          )}
        </Disclosure>
      </TimelineItem>
    );
  }
  if (item.type === 'text') {
    return (
      <TimelineItem icon={<MessageSquareText />}>
        <Disclosure label="Private output">
          <TraceText>{item.text}</TraceText>
        </Disclosure>
      </TimelineItem>
    );
  }
  if (item.type === 'source') {
    return (
      <TimelineItem icon={<ExternalLink />}>
        <a
          className="text-muted-foreground hover:text-foreground text-xs break-all underline underline-offset-4"
          href={item.url}
          target="_blank"
          rel="noreferrer"
        >
          {item.title ?? item.url}
        </a>
      </TimelineItem>
    );
  }
  return (
    <TimelineItem icon={<Braces />}>
      <Disclosure label={item.label} mono>
        <JsonBlock value={item.value} />
      </Disclosure>
    </TimelineItem>
  );
}

function TimelineItem({
  icon,
  last = false,
  children,
}: {
  icon: ReactNode;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative flex gap-3 pl-6">
      <div className="absolute top-0 left-0 flex h-full w-4 flex-col items-center">
        <span className="bg-popover text-muted-foreground z-10 mt-0.5 flex size-4 items-center justify-center [&>svg]:size-3.5">
          {icon}
        </span>
        {!last && <span className="bg-border w-px flex-1" />}
      </div>
      <div className="min-w-0 flex-1 pb-4">{children}</div>
    </div>
  );
}

function Disclosure({
  label,
  mono = false,
  children,
}: {
  label: string;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full min-w-0 items-center text-left text-xs">
        <span className={mono ? 'truncate font-mono' : 'truncate'}>
          {label}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function TraceText({
  children,
  className = '',
}: {
  children: string;
  className?: string;
}) {
  return (
    <p
      className={`text-muted-foreground text-xs leading-relaxed break-words whitespace-pre-wrap ${className}`}
    >
      {children}
    </p>
  );
}

function JsonBlock({ label, value }: { label?: string; value: unknown }) {
  return (
    <div className="mb-2 last:mb-0">
      {label && (
        <p className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wide uppercase">
          {label}
        </p>
      )}
      <pre className="bg-muted/70 overflow-x-auto rounded-md p-2 font-mono text-[10px] leading-relaxed break-words whitespace-pre-wrap">
        {typeof value === 'string'
          ? value
          : JSON.stringify(value ?? null, null, 2)}
      </pre>
    </div>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatDuration(milliseconds: number) {
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)}ms`
    : `${(milliseconds / 1_000).toFixed(1)}s`;
}
