"use client";

import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface MarkdownProps {
  children: string;
}

export function Markdown({ children }: MarkdownProps) {
  return (
    <div className="jarvis-markdown max-w-[76ch] text-left text-pretty">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children: linkChildren }) => (
            <a href={href} className="underline decoration-ink-2/50 underline-offset-2">
              {linkChildren}
            </a>
          ),
          code: ({ className, children: codeChildren, ...props }) => {
            const isBlock = Boolean(className);
            if (!isBlock) {
              return (
                <code className="rounded bg-surface-2/80 px-1 font-mono text-[0.9em]" {...props}>
                  {codeChildren}
                </code>
              );
            }
            return (
              <code className={className} {...props}>
                {codeChildren}
              </code>
            );
          },
          pre: ({ children: preChildren }) => (
            <pre className="overflow-x-auto rounded-md bg-surface-0 p-3 font-mono text-[12px]">
              {preChildren}
            </pre>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function markdownPreview(node: ReactNode): ReactNode {
  return node;
}
