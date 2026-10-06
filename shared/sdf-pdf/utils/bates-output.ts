// eslint-disable-next-line no-control-regex -- ZIP filenames must not contain control characters.
const unsafeFilenameCharacters = /[<>:"/\\|?*\u0000-\u001F]/g

function safeFilenamePart(value: string) {
  return value.replace(unsafeFilenameCharacters, '_').replace(/[. ]+$/g, '')
}

export function createUniqueBatesOutputFilename(
  sourceName: string,
  firstBates: string,
  lastBates: string,
  includeBatesRange: boolean,
  usedNames: Set<string>,
) {
  const originalBaseName = sourceName.replace(/\.pdf$/i, '') || 'Document'
  const safeBaseName = safeFilenamePart(originalBaseName) || 'Document'
  const batesRange = `${safeFilenamePart(firstBates) || 'Bates'}-${safeFilenamePart(lastBates) || 'Bates'}`
  const candidate = includeBatesRange
    ? `${safeBaseName} (${batesRange}).pdf`
    : `${safeBaseName}_Bates.pdf`
  let uniqueName = candidate
  let suffix = 2

  while (usedNames.has(uniqueName.toLowerCase())) {
    uniqueName = `${candidate.slice(0, -4)} (${suffix}).pdf`
    suffix += 1
  }

  usedNames.add(uniqueName.toLowerCase())
  return uniqueName
}
