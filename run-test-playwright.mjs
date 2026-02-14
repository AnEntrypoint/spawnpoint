import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

async function runTest() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.createContext()
  const page = await context.newPage()

  const testFilePath = path.resolve('./client/kalman-test.html')
  const fileUrl = `file://${testFilePath}`

  await page.goto(fileUrl, { waitUntil: 'networkidle' })

  await page.waitForTimeout(3000)

  const resultsContent = await page.content()
  console.log('Test Results Page Loaded Successfully\n')

  const extractedText = await page.evaluate(() => {
    const resultsDiv = document.getElementById('results')
    if (resultsDiv) {
      return resultsDiv.innerText
    }
    return 'No results found'
  })

  console.log(extractedText)

  await browser.close()
}

runTest().catch(console.error)
