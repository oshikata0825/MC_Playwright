import { test, expect } from '@playwright/test';
import { BASE_URL } from './config';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';

/**
 * MC_DPS_Upload_009.test.ts
 * 
 * Tests spreadsheet upload for EXISTING records and verifies the automatic setting of the SanFlag
 * based on whether the Company Name starts with "San_".
 */

const allUsers = JSON.parse(fs.readFileSync(path.join(__dirname, 'account.dat'), 'utf8'));
const users = allUsers.filter(user => user.id === 'MCTest5' || user.id === 'MCTest9');

test.describe('MC_DPS_Upload_009 - Existing Records SanFlag Automatic Setting Verification', () => {
  
  for (const user of users) {
    
    test(`Verify SanFlag Update for ${user.id}`, async ({ page }) => {
      test.setTimeout(900000); 
      
      console.log(`--- テスト開始: ${user.id} ---`);

      // ---------------------------------------------------
      // Step 1: Login
      // ---------------------------------------------------
      await test.step('Login', async () => {
        await page.goto(BASE_URL + '/Logon.aspx?ReturnUrl=%2fgtm%2fhome');
        await page.getByRole('textbox', { name: 'Company' }).fill(user.company);
        await page.getByRole('textbox', { name: 'Username' }).fill(user.id);
        await page.getByRole('textbox', { name: 'Password' }).fill(user.pass);
        await page.getByRole('link', { name: 'Login' }).click();
        console.log('✅ Login successful');
      });

      // ---------------------------------------------------
      // Step 2: Find Existing For-SIT- Records
      // ---------------------------------------------------
      let targetRecords: { id: string, originalName: string }[] = [];
      
      await test.step('Find Existing Records', async () => {
        await page.getByRole('button', { name: 'DPS' }).click();
        await page.getByRole('menuitem', { name: 'DPS Search/Reporting Lookup' }).click();
        
        const legacyFrame = page.frameLocator('iframe[name="legacy-outlet"]');
        await legacyFrame.locator('a#ctl00_LeftHandNavigation_LHN_ctl00').click(); // MC Company Lookup
        await page.waitForTimeout(3000);

        await page.keyboard.press('Escape');
        const header = legacyFrame.locator('th.rgHeader').filter({ hasText: /^CompanyID$/i });
        await header.locator('button.rgActionButton.rgOptions').first().click({ force: true });
        await page.waitForTimeout(1000);

        const condInput = legacyFrame.locator('input[id*="HCFMRCMBFirstCond_Input"]');
        await condInput.click({ force: true });
        for (let j = 0; j < 10; j++) await page.keyboard.press('ArrowUp');
        for (let i = 0; i < 15; i++) {
          const val = await condInput.inputValue();
          if (val?.toLowerCase() === 'startswith') {
            await page.keyboard.press('Enter');
            break;
          }
          await page.keyboard.press('ArrowDown');
          await page.waitForTimeout(200);
        }

        const valInput = legacyFrame.locator('input[id*="HCFMRTBFirstCond"]').first();
        await valInput.fill('For-SIT-');
        await valInput.press('Enter');
        await page.waitForTimeout(5000);

        const rows = legacyFrame.locator('tbody tr.rgRow, tbody tr.rgAltRow');
        const count = await rows.count();
        if (count === 0) throw new Error('Existing For-SIT- records not found.');
        
        console.log(`ℹ️ Found ${count} records. Selecting up to 5.`);
        for (let i = 0; i < Math.min(count, 5); i++) {
          const id = (await rows.nth(i).locator('td:nth-child(4)').innerText()).trim();
          const name = (await rows.nth(i).locator('td:nth-child(6)').innerText()).trim();
          targetRecords.push({ id, originalName: name });
        }
        console.log('✅ Target IDs:', targetRecords.map(r => r.id).join(', '));
      });

      // ---------------------------------------------------
      // Step 3: Prepare and Upload Excel
      // ---------------------------------------------------
      const ts = new Date().toISOString().replace(/[:.-]/g, '').substring(0, 14);
      const fileName = `SAN_UPDATE_009_${ts}.xlsx`;
      const testFilePath = path.join(__dirname, fileName);
      let excelData: { companyName: string, companyId: string, isSan: boolean }[] = [];

      await test.step('Prepare and Upload Excel', async () => {
        await page.getByRole('button', { name: 'Client Maintenance' }).click();
        await page.getByRole('menuitem', { name: 'Client Maintenance' }).click();
        const mainFrame = page.frameLocator('iframe[name="legacy-outlet"]');
        await mainFrame.locator('#ctl00_LeftHandNavigation_LHN_ctl00').click();
        
        const uploadActionLink = mainFrame.locator('td', { hasText: '130840 SpreadSheet upload - DPS' }).locator('..').locator('a', { hasText: /Upload/i });
        const popupPromise = page.waitForEvent('popup');
        await uploadActionLink.first().click();
        const popup = await popupPromise;
        await popup.waitForLoadState();

        let tableFrame: any = null;
        for (let i = 0; i < 30; i++) {
          for (const f of popup.frames()) {
            if (await f.locator('#lbxPageName:has-text("DPS Spreadsheet Upload")').count() > 0) {
              tableFrame = f; break;
            }
          }
          if (tableFrame) break;
          await popup.waitForTimeout(1000);
        }

        // Download Template
        const downloadBtn = tableFrame.locator('#ctl00_MainContent_hyxlnDownload').or(tableFrame.getByText('Download Excel Template')).first();
        const [download] = await Promise.all([popup.waitForEvent('download'), downloadBtn.click({ force: true })]);
        const baseTemplate = path.join(__dirname, `base_template_${user.id}_009.xlsx`);
        await download.saveAs(baseTemplate);

        // Edit Excel
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(baseTemplate);
        const worksheet = workbook.getWorksheet(1)!;
        const genAlphaNum = (l: number) => Math.random().toString(36).substring(2, 2 + l).toUpperCase();

        for (let i = 0; i < targetRecords.length; i++) {
          const r = i + 2;
          const record = targetRecords[i];
          const isSan = (i % 2 === 1); // Alternating San_ and non-San_
          const newName = (isSan ? 'San_' : '') + `Updated-009-${genAlphaNum(6)}`;
          
          worksheet.getCell(`A${r}`).value = '130840';
          worksheet.getCell(`B${r}`).value = record.id;
          worksheet.getCell(`C${r}`).value = 'X';
          worksheet.getCell(`D${r}`).value = 'X1';
          worksheet.getCell(`E${r}`).value = '001';
          worksheet.getCell(`F${r}`).value = newName;
          worksheet.getCell(`G${r}`).value = 'JP';
          worksheet.getCell(`Q${r}`).value = 'Y';
          worksheet.getCell(`U${r}`).value = 'Y';
          
          excelData.push({ companyName: newName, companyId: record.id, isSan });
          console.log(`   - Row ${r}: ID=${record.id}, NewName=${newName}, ExpectedSan=${isSan}`);
        }
        await workbook.xlsx.writeFile(testFilePath);
        try { fs.unlinkSync(baseTemplate); } catch(e) {}
        
        // Upload
        const chooseFileBtn = tableFrame.locator('#ctl00_MainContent_btxChooseFile').or(tableFrame.getByRole('button', { name: 'Choose File' })).first();
        const uploadBtn = tableFrame.locator('#ctl00_MainContent_lnxbtnUploadSpreadsheet').or(tableFrame.getByRole('link', { name: 'Upload and Import Data' })).first();
        const fileChooserPromise = popup.waitForEvent('filechooser');
        await chooseFileBtn.click();
        const fileChooser = await fileChooserPromise;
        await fileChooser.setFiles(testFilePath);
        await uploadBtn.click();

        // Monitor Status
        const refreshBtn = tableFrame.locator('#ctl00_MainContent_lnxBtnRefreshWorkflowStatus').or(tableFrame.getByRole('link', { name: 'Refresh' })).first();
        let finalStatus = '';
        let targetRow: any = null;
        for (let i = 0; i < 40; i++) {
          await popup.waitForTimeout(5000);
          await refreshBtn.click();
          await popup.waitForTimeout(2000);
          const rows = tableFrame.locator('#ctl00_MainContent_rgUploadWorkflowStatus_ctl00 tbody tr');
          const count = await rows.count();
          for (let j = 0; j < count; j++) {
            if ((await rows.nth(j).innerText()).includes(fileName)) {
              targetRow = rows.nth(j);
              finalStatus = (await targetRow.locator('td:nth-child(5)').innerText()).trim();
              break;
            }
          }
          console.log(`   - Attempt ${i+1}: Status = "${finalStatus}"`);
          if (finalStatus.includes('Error') || finalStatus.includes('Complete')) break;
        }
        if (!finalStatus.includes('Complete')) throw new Error(`Upload FAILED. Status: ${finalStatus}`);
        await popup.close();
      });

      // ---------------------------------------------------
      // Step 4: Verification in DPS Lookup
      // ---------------------------------------------------
      await test.step('Verification in DPS Lookup', async () => {
        await page.bringToFront();
        await page.getByRole('button', { name: 'DPS' }).click();
        await page.getByRole('menuitem', { name: 'DPS Search/Reporting Lookup' }).click();
        const legacyFrame = page.frameLocator('iframe[name="legacy-outlet"]');
        await legacyFrame.locator('a#ctl00_LeftHandNavigation_LHN_ctl00').click();
        await page.waitForTimeout(3000);

        const verificationErrors: string[] = [];

        for (const data of excelData) {
          console.log(`ℹ️ Verifying CompanyID: "${data.companyId}"`);
          try {
            await page.keyboard.press('Escape');
            const header = legacyFrame.locator('th.rgHeader').filter({ hasText: /^CompanyID$/i });
            await header.locator('button.rgActionButton.rgOptions').first().click({ force: true });
            await page.waitForTimeout(1000);
            
            const condInput = legacyFrame.locator('input[id*="HCFMRCMBFirstCond_Input"]');
            await condInput.click({ force: true });
            for (let j = 0; j < 10; j++) await page.keyboard.press('ArrowUp');
            for (let i = 0; i < 15; i++) {
              if ((await condInput.inputValue())?.toLowerCase() === 'equalto') { await page.keyboard.press('Enter'); break; }
              await page.keyboard.press('ArrowDown');
              await page.waitForTimeout(200);
            }
            const valInput = legacyFrame.locator('input[id*="HCFMRTBFirstCond"]').first();
            await valInput.fill(data.companyId);
            await valInput.press('Enter');
            await page.waitForTimeout(5000);

            const row = legacyFrame.locator('tbody tr.rgRow, tbody tr.rgAltRow').first();
            const editLink = row.locator('a', { hasText: 'Edit' });
            const [editPopup] = await Promise.all([page.waitForEvent('popup'), editLink.click()]);
            await editPopup.waitForLoadState();
            await editPopup.waitForTimeout(5000);

            let actualSanFlag = '', actualCompanyName = '', found = false, targetFrame: any = null;
            for (let i = 0; i < 15; i++) {
              for (const f of editPopup.frames()) {
                const sanFlagLoc = f.locator('#s2id_ctl00_MainContent_tabs_tabCompanyInfo_pnlSystem_drpSanFlag .select2-chosen').or(f.locator('#ctl00_MainContent_tabs_tabCompanyInfo_pnlSystem_lblSanFlag').locator('..').locator('.select2-chosen'));
                const nameLoc = f.locator('#txtCompanyName');
                if (await sanFlagLoc.count() > 0 && await nameLoc.count() > 0) {
                  actualSanFlag = (await sanFlagLoc.innerText()).trim();
                  actualCompanyName = (await nameLoc.inputValue()).trim();
                  targetFrame = f; found = true; break;
                }
              }
              if (found) break;
              await editPopup.waitForTimeout(1000);
            }

            // Screenshots
            if (found && targetFrame) {
              await targetFrame.locator('#txtCompanyName').first().scrollIntoViewIfNeeded();
              await editPopup.waitForTimeout(1000);
              await test.info().attach(`verify-${data.companyId}-name`, { body: await editPopup.screenshot(), contentType: 'image/png' });
              await targetFrame.locator('div[id*="pnlSystem"]').first().scrollIntoViewIfNeeded();
              await editPopup.waitForTimeout(1000);
              await test.info().attach(`verify-${data.companyId}-sanflag`, { body: await editPopup.screenshot(), contentType: 'image/png' });
            }

            if (!found) {
              verificationErrors.push(`❌ [${data.companyId}] Fields not found.`);
              await editPopup.close(); continue;
            }

            // Judgement
            const isSanMatch = (act: string, exp: boolean) => exp ? (act.includes('はい') || act.includes('Yes') || act.includes('邵ｺｯ')) : (act.includes('いいえ') || act.includes('No') || act.includes('邵ｺ繝ｻ樒ｸｺ'));
            const expSanLabel = data.isSan ? 'Yes/はい' : 'No/いいえ';
            if (isSanMatch(actualSanFlag, data.isSan)) console.log(`   ✅ [${data.companyId}] SanFlag Match: ${actualSanFlag}`);
            else verificationErrors.push(`❌ [${data.companyId}] SanFlag MISMATCH: Exp=${expSanLabel}, Act=${actualSanFlag}`);

            const expName = data.isSan ? data.companyName.replace(/^San_/, '') : data.companyName;
            if (actualCompanyName === expName) console.log(`   ✅ [${data.companyId}] Name Match: ${actualCompanyName}`);
            else verificationErrors.push(`❌ [${data.companyId}] Name MISMATCH: Exp=${expName}, Act=${actualCompanyName}`);

            await editPopup.close();
          } catch (e: any) {
            verificationErrors.push(`❌ [${data.companyId}] Error: ${e.message}`);
          }
        }
        if (verificationErrors.length > 0) (user as any).verificationErrors = verificationErrors;
      });

      // ---------------------------------------------------
      // Step 5: Logout
      // ---------------------------------------------------
      await test.step('Logout', async () => {
        try {
          const btn = `MC Test${user.id.substring(6)}`;
          await page.getByRole('button', { name: new RegExp(`^${btn}`) }).click();
          await page.getByRole('button', { name: ' Sign out' }).click();
          await page.waitForURL(/Logon|default/i);
        } catch (e) {}
        try { fs.unlinkSync(testFilePath); } catch(e) {}
        const errs = (user as any).verificationErrors;
        if (errs && errs.length > 0) {
          console.log('\n--- [Failures Summary] ---');
          errs.forEach((e: string) => console.log(e));
          throw new Error(`Verification failed with ${errs.length} errors.`);
        }
      });
    });
  }
});