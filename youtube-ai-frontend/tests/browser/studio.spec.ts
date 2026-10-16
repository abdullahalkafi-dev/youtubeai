import { expect, test, type Page } from '@playwright/test'
const channelId = '000000000000000000000001', threadId = '000000000000000000000002', runId = '000000000000000000000003'
const concept = { text: "HOW DO I TELL MY FAMILY\nI'M NEVER COMING HOME?", visual: 'Family phone call', emotion: 'restrained tears', colors: 'yellow and blue', aspectRatio: '16:9' }
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#244975"/><text x="30" y="100" fill="white" font-size="40">THE FAMILY CALL</text></svg>')
const now = '2026-10-16T00:00:00Z'
async function setup(page: Page, legacy = false) {
  const state = {
    status: 'awaiting_images', updatedAt: now, paidRequests: 0, imageRequests: [] as Record<string, unknown>[], assetUploads: 0, chatUploads: 0, referenceUploads: 0, notes: [] as string[], revisions: [] as { path: string; body: Record<string, unknown> }[], preferenceWrites: [] as Record<string, unknown>[],
    preferences: { revision: 1, enabled: true, duration: { min: 8,max: 10 }, wordsPerMinute: 130, instructions: ['Use recognizable faces'], approvedExamples: [], visualReferences: [], visualReferenceAssets: [] as { url: string; role: string; note?: string }[], identityReferences: [] as { name: string; url: string }[], excludeHost: false, excludeLogo: false },
    artifacts: [
      { _id: 'package-1', kind: 'packaging', key: 'packaging', version: 1, status: 'ready', data: { title: 'Life in Prison: The Hardest Conversation With Your Family', rationale: 'A family-centered prison episode', description: 'An episode about family separation.', thumbnails: [concept,concept] } },
      { _id: 'image-1', kind: 'thumbnail', key: 'thumbnail-0', version: 1, status: 'pending', data: { concept, url: '' }, review: { status: 'pass', issues: [] } },
      { _id: 'image-2', kind: 'thumbnail', key: 'thumbnail-1', version: 1, status: 'pending', data: { concept, url: '' }, review: { status: 'pass', issues: [] } },
    ],
  }
  const message = { id: 'message-1', role: 'assistant', content: legacy ? '<!-- THUMBNAILS_START -->\n### Concept 1: First\n**Text overlay:** FAMILY CALL\n**Visual concept:**\nA phone call\n**Color scheme:** Blue\n### Concept 2: Second\n**Text overlay:** COMING HOME\n**Visual concept:**\nA family\n**Color scheme:** Yellow\n<!-- THUMBNAILS_END -->' : 'Preparing your episode…', metadata: legacy ? { category: 'thumbnail', autoImages: true } : { runId, executionVersion: 1 }, createdAt: now }
  const thread = { id: threadId, channelId, title: 'Family phone call', type: 'standalone', status: 'active', createdAt: now, updatedAt: now, messages: [message], totalPromptTokens: 0,totalCompletionTokens: 0,totalCachedTokens: 0 }
  await page.addInitScript(() => localStorage.setItem('auth_token', 'browser-test-only'))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const json = async (data: unknown) => route.fulfill({ json: { data } })
    if (path.endsWith('/auth/profile')) return json({ id: 'user-1',email: 'test@example.test',name: 'Test Creator' })
    if (path === '/api/channels') return json([{ id: channelId,name: 'Unique Mecca Audio',subscriberCount: 100,totalVideos: 10,totalViews: 1000,seoSettings: {} }])
    if (path.endsWith('/creative-preferences/references')) {
      state.referenceUploads++
      state.preferences = { ...state.preferences, revision: state.preferences.revision + 1, visualReferenceAssets: [{ url: 'https://assets.test/strong.png', role: 'style', note: 'strong tears' }] }
      return json(state.preferences)
    }
    if (path.endsWith('/creative-preferences')) {
      if (request.method() === 'PATCH') { const body = request.postDataJSON(); state.preferenceWrites.push(body); state.preferences = { ...state.preferences,...body,revision: state.preferences.revision+1 } }
      return json(state.preferences)
    }
    if (path.endsWith('/versions')) {
      const artifact = state.artifacts.find(item => path.includes('/' + item._id + '/'))!
      return json([{ ...artifact, version: 1, outdated: true, data: { ...artifact.data, title: 'Previous title for the family call' } }, { ...artifact, _id: artifact._id + '-v2', version: 2, data: { ...artifact.data, title: 'Revised title for the family call' } }])
    }
    if (path.includes('/artifacts/')) { state.revisions.push({ path,body: request.postDataJSON() }); return json({ runId,messageId: 'message-1' }) }
    if (path.endsWith('/generate-image-direct')) { state.imageRequests.push(request.postDataJSON()); return json({ runId, messageId: 'message-1' }) }
    if (path.endsWith('/upload-asset')) { state.assetUploads++; return json({ url: 'https://assets.test/reference.png', filename: 'reference.png' }) }
    if (path.endsWith('/messages/upload')) { state.chatUploads++; return json({ runId, messageId: 'message-1' }) }
    if (path.endsWith('/cancel')) { state.status = 'cancelled'; return json({}) }
    if (path.includes('/generate-thumbnail-image')) { state.paidRequests++; return json({}) }
    if (path.endsWith('/runs/' + runId)) return json({ id: runId,status: state.status,stage: 'writing',artifacts: state.artifacts,notes: state.notes })
    if (path.endsWith('/runs')) return json([])
    if (path === '/api/threads/' + threadId) return json({ ...thread, updatedAt: state.updatedAt })
    if (path.endsWith('/threads')) return json([{ ...thread,messageCount: 1 }])
    return json([])
  })
  await page.goto('/chat')
  await expect(page.getByText('Family phone call', { exact: true }).first()).toBeVisible()
  return state
}
test('shows two slots and reconnects without starting paid requests', async ({ page }) => {
  const state = await setup(page)
  await expect(page.getByText('Generating automatically')).toHaveCount(2)
  await expect(page.getByText('Life in Prison: The Hardest Conversation With Your Family')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Generating automatically')).toHaveCount(2)
  expect(state.paidRequests).toBe(0)
  state.status = 'completed_with_issues'
  state.artifacts[1].status = 'ready'; state.artifacts[1].data.url = image
  state.artifacts[2].status = 'failed'
  await expect(page.getByText('Ready with items to review')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry this image' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Retry this image' }).click()
  expect(state.revisions[0].path).toContain('image-2/retry')
  expect(state.paidRequests).toBe(0)
})
test('edits only the selected thumbnail with complete wording', async ({ page }) => {
  const state = await setup(page)
  state.status = 'completed'; state.artifacts[1].status = 'ready'; state.artifacts[1].data.url = image
  state.artifacts[2].status = 'ready'; state.artifacts[2].data.url = image
  await expect(page.getByText('Your episode is ready')).toBeVisible()
  await page.getByRole('button', { name: 'Edit',exact: true }).first().click()
  await page.getByRole('textbox', { name: 'What should change?' }).fill("Change only the headline to HOW DO I TELL MY FAMILY I'M NEVER COMING HOME?")
  await page.getByRole('button', { name: 'Create revision',exact: true }).click()
  expect(state.revisions[0].path).toContain('image-1/revisions')
  expect(String(state.revisions[0].body.content)).toContain("I'M NEVER COMING HOME?")
})
test('saves explicit channel preferences', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('button', { name: 'Creative preferences',exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('textbox', { name: 'Standing instructions' }).fill('Preserve complete thumbnail wording')
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(state.preferenceWrites[0].instructions).toEqual(['Preserve complete thumbnail wording'])
})
test('historical autoImages metadata is passive on mount and reload', async ({ page }) => {
  const state = await setup(page, true)
  await expect(page.getByRole('button', { name: '1-Click Generate' })).toHaveCount(2)
  await page.reload()
  await expect(page.getByRole('button', { name: '1-Click Generate' })).toHaveCount(2)
  expect(state.paidRequests).toBe(0)
})
test('cancels a server run explicitly', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('button', { name: 'Stop',exact: true }).click()
  await expect(page.getByText('cancelled', { exact: true })).toBeVisible()
  expect(state.status).toBe('cancelled')
})

test('opens connected packaging versions without starting a revision', async ({ page }) => {
  const state = await setup(page)
  state.status = 'completed'; state.artifacts[1].status = 'ready'; state.artifacts[1].data.url = image
  state.artifacts[2].status = 'ready'; state.artifacts[2].data.url = image
  await expect(page.getByText('Your episode is ready')).toBeVisible()
  await page.getByRole('button', { name: 'Versions', exact: true }).last().click()
  await expect(page.getByRole('button', { name: 'Version 1 (previous)', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Version 2', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Revised title for the family call' })).toBeVisible()
  await page.getByRole('button', { name: 'Version 1 (previous)', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Previous title for the family call' })).toBeVisible()
  expect(state.revisions).toHaveLength(0)
  expect(state.paidRequests).toBe(0)
})

test('refreshes old artifact status after a revision updates the thread', async ({ page }) => {
  const state = await setup(page)
  state.status = 'completed'; state.artifacts[1].status = 'ready'; state.artifacts[1].data.url = image
  state.artifacts[2].status = 'ready'; state.artifacts[2].data.url = image
  await expect(page.getByText('Your episode is ready')).toBeVisible()
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
  await page.getByRole('textbox', { name: 'What should change?' }).fill('Revise this scene')
  Object.assign(state.artifacts[1], { outdated: true })
  state.updatedAt = '2026-10-16T00:01:00Z'
  await page.getByRole('button', { name: 'Create revision', exact: true }).click()
  await expect(page.getByText('Previous or outdated outputs', { exact: true })).toBeVisible()
  expect(state.paidRequests).toBe(0)
})

test('reports queued image-mode requests as started rather than generated', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('button', { name: 'Generate Image', exact: true }).click()
  const request = 'Write a script, title and two thumbnails about the family phone call'
  await page.getByPlaceholder('Ask about script, SEO, thumbnail, trends... (Shift + Enter for new line)').fill(request)
  await page.getByPlaceholder('Ask about script, SEO, thumbnail, trends... (Shift + Enter for new line)').press('Enter')
  await expect(page.getByText('Your request is underway. Follow its progress in chat.', { exact: true })).toBeVisible()
  expect(state.imageRequests).toHaveLength(1)
  expect(state.imageRequests[0].prompt).toBe(request)
  await expect(page.getByText('Image generated!', { exact: true })).toHaveCount(0)
})
test('pinning a reference image does not send an implicit chat request', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('button', { name: 'Generate Image', exact: true }).click()
  await page.locator('input[type=file]').first().setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a55kAAAAASUVORK5CYII=', 'base64') })
  await expect(page.getByText('Image pinned for editing. Type your changes below.', { exact: true })).toBeVisible()
  expect(state.assetUploads).toBe(1)
  expect(state.chatUploads).toBe(0)
  expect(state.imageRequests).toHaveLength(0)
})
test('tells the client what the agent is doing in plain language', async ({ page }) => {
  const state = await setup(page)
  state.notes = ['I will research this first, then write a script of about 9 minutes and create two thumbnails and generate both images automatically.']
  await page.reload()
  await expect(page.getByText('create two thumbnails and generate both images automatically', { exact: false })).toBeVisible()
  expect(state.paidRequests).toBe(0)
})
test('uploads an approved style reference from the preferences dialog', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('button', { name: 'Creative preferences',exact: true }).click()
  await page.getByLabel('Reference image file').setInputFiles({ name: 'strong.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') })
  await page.getByRole('textbox', { name: 'Reference note', exact: true }).fill('strong tears')
  await page.getByRole('button', { name: 'Add reference' }).click()
  await expect(page.getByText('strong tears', { exact: true })).toBeVisible()
  expect(state.referenceUploads).toBe(1)
})
