import {test,expect} from 'vitest'
import {runtime} from '../server/runtime'
const azure={NODE_ENV:'production',APP_ORIGIN:'https://example.azurewebsites.net',ENTRA_TENANT_ID:'tenant',ENTRA_CLIENT_ID:'client',ENTRA_AUDIENCE:'api',ENTRA_SCOPE:'api://api/access_as_user'}
test('normal production still requires durable services',()=>expect(()=>runtime(azure)).toThrow('PostgreSQL'))
test('explicit Azure test mode permits disposable storage',()=>expect(runtime({...azure,AZURE_TEST_MODE:'true'})).toMatchObject({dev:false,testing:true,dataDir:'/tmp/sdf-production-test'}))
test('test mode never permits development identity or missing Entra',()=>{expect(()=>runtime({...azure,AZURE_TEST_MODE:'true',DEV_AUTH:'true'})).toThrow('DEV_AUTH');expect(()=>runtime({...azure,AZURE_TEST_MODE:'true',ENTRA_CLIENT_ID:''})).toThrow('Entra')})
test('test mode requires HTTPS and production runtime',()=>{expect(()=>runtime({...azure,AZURE_TEST_MODE:'true',APP_ORIGIN:'http://example.com'})).toThrow('HTTPS');expect(()=>runtime({AZURE_TEST_MODE:'true'})).toThrow('NODE_ENV')})
test('test mode rejects accidental durable-service connections',()=>expect(()=>runtime({...azure,AZURE_TEST_MODE:'true',DATABASE_URL:'postgres://example'})).toThrow('disposable'))
