import { defineConfig } from '@playwright/test'
export default defineConfig({testDir:'tests',testMatch:'browser.spec.ts',workers:1,timeout:60000,use:{headless:true,viewport:{width:1440,height:1000},launchOptions:process.platform==='win32'?{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}:{},trace:'retain-on-failure'},reporter:'list'})
