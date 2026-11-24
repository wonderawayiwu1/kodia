/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { JSX, useEffect, useMemo, useState } from 'react'
import { marked, MarkedToken, Token } from 'marked'

import { convertToVscodeLang, detectLanguage } from '../../../../common/helpers/languageHelpers.js'
import { BlockCodeApplyWrapper } from './ApplyBlockHoverButtons.js'
import { useAccessor } from '../util/services.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { isAbsolute } from '../../../../../../../base/common/path.js'
import { separateOutFirstLine } from '../../../../common/helpers/util.js'
import { BlockCode } from '../util/inputs.js'
import { CodespanLocationLink } from '../../../../common/chatThreadServiceTypes.js'
import { getBasename, getRelative, voidOpenFileFn } from '../sidebar-tsx/SidebarChat.js'


export type ChatMessageLocation = {
	threadId: string;
	messageIdx: number;
}

type ApplyBoxLocation = ChatMessageLocation & { tokenIdx: string }

export const getApplyBoxId = ({ threadId, messageIdx, tokenIdx }: ApplyBoxLocation) => {
	return `${threadId}-${messageIdx}-${tokenIdx}`
}

function isValidUri(s: string): boolean {
	return s.length > 5 && isAbsolute(s) && !s.includes('//') && !s.includes('/*') // common case that is a false positive is comments like //
}

// renders contiguous string of latex eg $e^{i\pi}$
const LatexRender = ({ latex }: { latex: string }) => {
	return <span className="katex-error text-red-500">{latex}</span>
}

const Codespan = ({ text, className, onClick, tooltip }: { text: string, className?: string, onClick?: () => void, tooltip?: string }) => {

	// TODO compute this once for efficiency. we should use `labels.ts/shorten` to display duplicates properly

	return <code
		className={`font-mono font-medium rounded-sm bg-void-bg-1 px-1 ${className}`}
		onClick={onClick}
		{...tooltip ? {
			'data-tooltip-id': 'void-tooltip',
			'data-tooltip-content': tooltip,
			'data-tooltip-place': 'top',
		} : {}}
	>
		{text}
	</code>

}

// Concurrency limiter for background codespan link resolution so opening long threads never floods IPC / LSP
const MAX_CONCURRENT_LINK_LOOKUPS = 2
let activeLinkLookups = 0
const pendingLinkLookupQueue: Array<() => void> = []
function enqueueLinkLookup(fn: () => Promise<void>) {
	const run = () => {
		activeLinkLookups += 1
		fn().finally(() => {
			activeLinkLookups -= 1
			const next = pendingLinkLookupQueue.shift()
			if (next) next()
		})
	}
	if (activeLinkLookups < MAX_CONCURRENT_LINK_LOOKUPS) {
		run()
	} else if (pendingLinkLookupQueue.length < 60) {
		pendingLinkLookupQueue.push(run)
	}
}

const CodespanWithLink = React.memo(({ text, rawText, chatMessageLocation }: { text: string, rawText: string, chatMessageLocation: ChatMessageLocation }) => {

	const accessor = useAccessor()
	const chatThreadService = accessor.get('IChatThreadService')
	const { messageIdx, threadId } = chatMessageLocation

	const isClosed = rawText.endsWith('`')
	const initialCached = isClosed ? chatThreadService.getCodespanLink({ codespanStr: text, messageIdx, threadId }) : undefined
	const [resolvedLink, setResolvedLink] = useState<CodespanLocationLink | undefined>(initialCached)

	useEffect(() => {
		if (!isClosed) return
		// If already cached (including negative `null` cache), skip any lookup
		const cached = chatThreadService.getCodespanLink({ codespanStr: text, messageIdx, threadId })
		if (cached !== undefined) {
			setResolvedLink(cached)
			return
		}
		// Only resolve likely file paths or concise symbol names; skip long commands/JSON/prose
		const trimmed = text.trim()
		if (!trimmed || trimmed.length > 80 || /\s/.test(trimmed)) {
			void chatThreadService.addCodespanLink({ newLinkText: text, newLinkLocation: null, messageIdx, threadId })
			return
		}
		let cancelled = false
		enqueueLinkLookup(async () => {
			if (cancelled) return
			try {
				const found = await chatThreadService.generateCodespanLink({ codespanStr: text, threadId })
				await chatThreadService.addCodespanLink({ newLinkText: text, newLinkLocation: found, messageIdx, threadId })
				if (!cancelled && found) {
					setResolvedLink(found)
				}
			} catch {
				// ignore lookup failure
			}
		})
		return () => { cancelled = true }
	}, [isClosed, text, messageIdx, threadId, chatThreadService])

	const link = resolvedLink
	let tooltip: string | undefined = undefined
	let displayText = link?.displayText || text

	if (isClosed && isValidUri(displayText)) {
		tooltip = getRelative(URI.file(displayText), accessor)
		displayText = getBasename(displayText)
	}

	const onClick = () => {
		if (!link) return;
		if (link.selection)
			voidOpenFileFn(link.uri, accessor, [link.selection.startLineNumber, link.selection.endLineNumber]);
		else
			voidOpenFileFn(link.uri, accessor);
	}

	return <Codespan
		text={displayText}
		onClick={onClick}
		className={link ? 'underline hover:brightness-90 transition-all duration-200 cursor-pointer' : ''}
		tooltip={tooltip || undefined}
	/>
})


const paragraphToLatexSegments = (paragraphText: string) => {

	const segments: React.ReactNode[] = [];

	if (paragraphText
		&& !(paragraphText.includes('#') || paragraphText.includes('`')) // don't process latex if a codespan or header tag
		&& !/^[\w\s.()[\]{}]+$/.test(paragraphText) // don't process latex if string only contains alphanumeric chars, whitespace, periods, and brackets
	) {
		const rawText = paragraphText;
		// Regular expressions to match LaTeX delimiters
		const displayMathRegex = /\$\$(.*?)\$\$/g;  // Display math: $$...$$
		const inlineMathRegex = /\$((?!\$).*?)\$/g; // Inline math: $...$ (but not $$)

		// Check if the paragraph contains any LaTeX expressions
		if (displayMathRegex.test(rawText) || inlineMathRegex.test(rawText)) {
			// Reset the regex state (since we used .test earlier)
			displayMathRegex.lastIndex = 0;
			inlineMathRegex.lastIndex = 0;

			// Parse the text into segments of regular text and LaTeX
			let lastIndex = 0;
			let segmentId = 0;

			// First replace display math ($$...$$)
			let match;
			while ((match = displayMathRegex.exec(rawText)) !== null) {
				const [fullMatch, formula] = match;
				const matchIndex = match.index;

				// Add text before the LaTeX expression
				if (matchIndex > lastIndex) {
					const textBefore = rawText.substring(lastIndex, matchIndex);
					segments.push(
						<span key={`text-${segmentId++}`}>
							{textBefore}
						</span>
					);
				}

				// Add the LaTeX expression
				segments.push(
					<LatexRender key={`latex-${segmentId++}`} latex={fullMatch} />
				);

				lastIndex = matchIndex + fullMatch.length;
			}

			// Add any remaining text (which might contain inline math)
			if (lastIndex < rawText.length) {
				const remainingText = rawText.substring(lastIndex);

				// Process inline math in the remaining text
				lastIndex = 0;
				inlineMathRegex.lastIndex = 0;
				const inlineSegments: React.ReactNode[] = [];

				while ((match = inlineMathRegex.exec(remainingText)) !== null) {
					const [fullMatch] = match;
					const matchIndex = match.index;

					// Add text before the inline LaTeX
					if (matchIndex > lastIndex) {
						const textBefore = remainingText.substring(lastIndex, matchIndex);
						inlineSegments.push(
							<span key={`inline-text-${segmentId++}`}>
								{textBefore}
							</span>
						);
					}

					// Add the inline LaTeX
					inlineSegments.push(
						<LatexRender key={`inline-latex-${segmentId++}`} latex={fullMatch} />
					);

					lastIndex = matchIndex + fullMatch.length;
				}

				// Add any remaining text after all inline math
				if (lastIndex < remainingText.length) {
					inlineSegments.push(
						<span key={`inline-final-${segmentId++}`}>
							{remainingText.substring(lastIndex)}
						</span>
					);
				}

				segments.push(...inlineSegments);
			}


		}
	}


	return segments
}


export type RenderTokenOptions = { isApplyEnabled?: boolean, isLinkDetectionEnabled?: boolean }
const RenderToken = ({ token, inPTag, codeURI, chatMessageLocation, tokenIdx, ...options }: { token: Token | string, inPTag?: boolean, codeURI?: URI, chatMessageLocation?: ChatMessageLocation, tokenIdx: string, } & RenderTokenOptions): React.ReactNode => {
	const accessor = useAccessor()
	const languageService = accessor.get('ILanguageService')

	// deal with built-in tokens first (assume marked token)
	const t = token as MarkedToken

	if (t.raw.trim() === '') {
		return null;
	}

	if (t.type === 'space') {
		return <span>{t.raw}</span>
	}

	if (t.type === 'code') {
		const [firstLine, remainingContents] = separateOutFirstLine(t.text)
		const firstLineIsURI = isValidUri(firstLine) && !codeURI
		const contents = firstLineIsURI ? (remainingContents?.trimStart() || '') : t.text // exclude first-line URI from contents

		if (!contents) return null

		// figure out langauge and URI
		let uri: URI | null
		let language: string
		if (codeURI) {
			uri = codeURI
		}
		else if (firstLineIsURI) { // get lang from the uri in the first line of the markdown
			uri = URI.file(firstLine)
		}
		else {
			uri = null
		}

		if (t.lang) { // a language was provided. empty string is common so check truthy, not just undefined
			language = convertToVscodeLang(languageService, t.lang) // convert markdown language to language that vscode recognizes (eg markdown doesn't know bash but it does know shell)
		}
		else { // no language provided - fallback - get lang from the uri and contents
			language = detectLanguage(languageService, { uri, fileContents: contents })
		}

		if (options.isApplyEnabled && chatMessageLocation) {
			const isCodeblockClosed = t.raw.trimEnd().endsWith('```') // user should only be able to Apply when the code has been closed (t.raw ends with '```')

			const applyBoxId = getApplyBoxId({
				threadId: chatMessageLocation.threadId,
				messageIdx: chatMessageLocation.messageIdx,
				tokenIdx: tokenIdx,
			})
			return <BlockCodeApplyWrapper
				canApply={isCodeblockClosed}
				applyBoxId={applyBoxId}
				codeStr={contents}
				language={language}
				uri={uri || 'current'}
			>
				<BlockCode
					initValue={contents.trimEnd()} // \n\n adds a permanent newline which creates a flash
					language={language}
				/>
			</BlockCodeApplyWrapper>
		}

		return <BlockCode
			initValue={contents}
			language={language}
		/>
	}

	if (t.type === 'heading') {

		const HeadingTag = `h${t.depth}` as keyof JSX.IntrinsicElements

		return <HeadingTag>
			<ChatMarkdownRender chatMessageLocation={chatMessageLocation} string={t.text} inPTag={true} codeURI={codeURI} {...options} />
		</HeadingTag>
	}

	if (t.type === 'table') {

		return (
			<div>
				<table>
					<thead>
						<tr>
							{t.header.map((h, hIdx: number) => (
								<th key={hIdx}>
									{h.text}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{t.rows.map((row, rowIdx: number) => (
							<tr key={rowIdx}>
								{row.map((r, rIdx: number) => (
									<td key={rIdx} >
										{r.text}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		)
	}

	if (t.type === 'hr') {
		return <hr />
	}

	if (t.type === 'blockquote') {
		return <blockquote>{t.text}</blockquote>
	}

	if (t.type === 'list_item') {
		return <li>
			<input type='checkbox' checked={t.checked} readOnly />
			<span>
				<ChatMarkdownRender chatMessageLocation={chatMessageLocation} string={t.text} inPTag={true} codeURI={codeURI} {...options} />
			</span>
		</li>
	}

	if (t.type === 'list') {
		const ListTag = t.ordered ? 'ol' : 'ul'

		return (
			<ListTag start={t.start ? t.start : undefined}>
				{t.items.map((item, index) => (
					<li key={index}>
						{item.task && (
							<input type='checkbox' checked={item.checked} readOnly />
						)}
						<span>
							<ChatMarkdownRender chatMessageLocation={chatMessageLocation} string={item.text} inPTag={true} {...options} />
						</span>
					</li>
				))}
			</ListTag>
		)
	}

	if (t.type === 'paragraph') {

		// check for latex
		const latexSegments = paragraphToLatexSegments(t.raw)
		if (latexSegments.length !== 0) {
			if (inPTag) {
				return <span className='block'>{latexSegments}</span>;
			}
			return <p>{latexSegments}</p>;
		}

		// if no latex, default behavior
		const contents = <>
			{t.tokens.map((token, index) => (
				<RenderToken key={index}
					token={token}
					tokenIdx={`${tokenIdx ? `${tokenIdx}-` : ''}${index}`} // assign a unique tokenId to inPTag components
					chatMessageLocation={chatMessageLocation}
					inPTag={true}
					{...options}
				/>
			))}
		</>

		if (inPTag) return <span className='block'>{contents}</span>
		return <p>{contents}</p>
	}

	if (t.type === 'text' || t.type === 'escape' || t.type === 'html') {
		return <span>{t.raw}</span>
	}

	if (t.type === 'def') {
		return <></> // Definitions are typically not rendered
	}

	if (t.type === 'link') {
		return (
			<a
				onClick={() => { window.open(t.href) }}
				href={t.href}
				title={t.title ?? undefined}
				className='underline cursor-pointer hover:brightness-90 transition-all duration-200 text-void-fg-2'
			>
				{t.text}
			</a>
		)
	}

	if (t.type === 'image') {
		return <img
			src={t.href}
			alt={t.text}
			title={t.title ?? undefined}

		/>
	}

	if (t.type === 'strong') {
		return <strong>{t.text}</strong>
	}

	if (t.type === 'em') {
		return <em>{t.text}</em>
	}

	// inline code
	if (t.type === 'codespan') {

		if (options.isLinkDetectionEnabled && chatMessageLocation) {
			return <CodespanWithLink
				text={t.text}
				rawText={t.raw}
				chatMessageLocation={chatMessageLocation}
			/>

		}

		return <Codespan text={t.text} />
	}

	if (t.type === 'br') {
		return <br />
	}

	// strikethrough
	if (t.type === 'del') {
		return <del>{t.text}</del>
	}
	// default
	return (
		<div className='bg-orange-50 rounded-sm overflow-hidden p-2'>
			<span className='text-sm text-orange-500'>Unknown token rendered...</span>
		</div>
	)
}


export const ChatMarkdownRender = React.memo(({ string, inPTag = false, chatMessageLocation, codeURI, isApplyEnabled, isLinkDetectionEnabled }: { string: string, inPTag?: boolean, codeURI?: URI, chatMessageLocation: ChatMessageLocation | undefined } & RenderTokenOptions) => {
	const tokens = useMemo(() => {
		const normalized = string.replaceAll('\n•', '\n\n•')
		return marked.lexer(normalized)
	}, [string])
	return (
		<>
			{tokens.map((token, index) => (
				<RenderToken
					key={index}
					token={token}
					inPTag={inPTag}
					codeURI={codeURI}
					chatMessageLocation={chatMessageLocation}
					tokenIdx={index + ''}
					isApplyEnabled={isApplyEnabled}
					isLinkDetectionEnabled={isLinkDetectionEnabled}
				/>
			))}
		</>
	)
})
