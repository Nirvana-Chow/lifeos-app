import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMfaSetup,passwordLoginDestination} from '../src/personal-candidate/owner-mfa-flow.ts';

const setup={method:'totp',totpURI:'otpauth://totp/LifeOS:fixture%40example.invalid?secret=JBSWY3DPEHPK3PXP&issuer=LifeOS&digits=6&period=30',backupCodes:['synthetic-backup-a','synthetic-backup-b']};
test('binding accepts native TOTP data for local QR and manual Apple Passwords setup',()=>{
 const value=parseMfaSetup(setup);assert.equal(value.secret,'JBSWY3DPEHPK3PXP');assert.equal(value.uri,setup.totpURI);assert.deepEqual(value.backupCodes,setup.backupCodes);
});
test('binding rejects wrong URI schemes, unexpected TOTP parameters and invalid backup data',()=>{
 for(const data of [null,{}, {...setup,method:'otp'},{...setup,totpURI:'https://example.invalid/?secret=JBSWY3DPEHPK3PXP'},{...setup,totpURI:setup.totpURI.replace('issuer=LifeOS','issuer=Other')},{...setup,totpURI:setup.totpURI.replace('digits=6','digits=8')},{...setup,totpURI:setup.totpURI.replace('period=30','period=60')},{...setup,totpURI:setup.totpURI+'&secret=AAAAAAAA'},{...setup,backupCodes:[]},{...setup,backupCodes:[{}]}])assert.throws(()=>parseMfaSetup(data),/绑定信息无效/);
});
test('password success requires native challenge or server enrollment decision before private access',()=>{
 assert.equal(passwordLoginDestination({twoFactorRedirect:true},true),'challenge');
 assert.equal(passwordLoginDestination({user:{id:'synthetic'}},true),'/account/mfa');
 assert.equal(passwordLoginDestination({user:{id:'synthetic'}},false),'/review/admin');
});
