export function runtime(env:NodeJS.ProcessEnv) {
  const production=env.NODE_ENV==='production',dev=env.DEV_AUTH==='true',testing=env.AZURE_TEST_MODE==='true'
  const origin=env.APP_ORIGIN||`http://127.0.0.1:${env.PORT||4180}`
  if(testing&&!production)throw new Error('AZURE_TEST_MODE requires NODE_ENV=production.')
  if(production&&(dev||!env.ENTRA_TENANT_ID||!env.ENTRA_CLIENT_ID||!origin.startsWith('https://')))throw new Error('Azure requires Entra settings and an HTTPS origin. DEV_AUTH is forbidden.')
  if(production&&!testing&&(!env.DATABASE_URL||!env.AZURE_STORAGE_ACCOUNT_URL))throw new Error('Production requires PostgreSQL and private Azure Blob Storage.')
  if(testing&&(env.DATABASE_URL||env.AZURE_STORAGE_ACCOUNT_URL))throw new Error('Testing mode uses disposable local storage. Remove database and Blob settings.')
  return {production,dev,testing,origin,dataDir:testing?(env.DATA_DIR||'/tmp/sdf-production-test'):(env.DATA_DIR||'data')}
}
