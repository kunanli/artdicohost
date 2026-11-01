// Isolated composition for one attendee across public facts, notices and Wallet.
// All attendee/storage/provider values are synthetic; capabilities stay in memory.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createWalletFixture} from '../apple-wallet-fixture.mjs';
import {peopleRuntimeFixture} from './people-runtime-fixture.mjs';
import {createInitialContent} from '../../src/config/content.mjs';
import {eventConfig,assessPublishedEventFacts} from '../../src/config/event.mjs';
import {createObjectJournal} from '../../functions/cloud-content/object-journal.mjs';
import {createRegistrationConfirmationService} from '../../functions/registration-confirmation/service.mjs';
import {createRegistrationConfirmationApi} from '../../functions/registration-confirmation/handler.mjs';
import {createAppleWalletService} from '../../functions/apple-wallet/service.mjs';
import {createAppleWalletApi} from '../../functions/apple-wallet/handler.mjs';

// This is the existing people-runtime-fixture's independent synthetic secret.
const SECRET='synthetic-people-registration-token-secret-123456';

/** Return only public event facts suitable for a browser evidence report. */
export function p6PublicEventFacts(facts) {
  assert.equal(facts?.ready,true,'public event facts must be verified before reporting');
  assert.equal(typeof facts.key,'string');
  const value=JSON.parse(facts.key);
  return Object.freeze({id:value.id,title:value.title,date:value.date,
    time:value.opening+'–'+value.end,checkIn:value.checkIn,venue:value.venue,timezone:value.timezone,
    factsKeySha256:createHash('sha256').update(facts.key).digest('hex')});
}

/** A real application over memory OSS, with a disposable signer only for tests.
 * Call cleanup() in finally; never serialize the returned fixture or capabilities.
 */
export async function p6EventFactsFixture() {
  const walletFixture=await createWalletFixture();
  try {
    const clock=()=>walletFixture.now;
    const runtime=await peopleRuntimeFixture({capacity:3,mail:true,clock});
    const {app,users,objects}=runtime;
    const content=createInitialContent();content.event.venue=eventConfig.venue.address;
    const draft=(await app.store.read()).draft;
    const saved=await app.store.save(draft.revision,content,users[0].id);
    const initialPublished=await app.store.publish(saved.revision,users[0].id);
    const eventFactsReadiness=async()=>assessPublishedEventFacts((await app.store.read()).published);
    const initialFacts=await eventFactsReadiness();
    assert.equal(initialFacts.ready,true,'initial synthetic publication matches the checked event facts');
    const publicFacts=p6PublicEventFacts(initialFacts);

    const registration=await runtime.seedPublic({intake:'general-v2',name:'合成跨渠道核对参会者',
      email:'synthetic.p6.attendee@example.invalid',organization:'合成跨渠道核对机构'});
    const registrationId=registration.reference_code;
    assert.match(registrationId,/^[A-Za-z0-9_-]{43}$/u);
    const receiptToken=registration.confirmation?.receiptToken;
    assert.equal(typeof receiptToken,'string','actual saved application supplies its private receipt capability');
    assert.equal(runtime.messages.length,1,'new pending application creates one synthetic application receipt');
    await runtime.approvePublic(registrationId);
    assert.equal(runtime.messages.length,2,'actual approval adds one distinct formal confirmation');
    const preview=await app.confirmationService.staffReminderPreview({actor:users[0],registrationIds:[registrationId]});
    assert.equal(preview.rows.length,1);assert.equal(preview.rows[0].registrationId,registrationId);
    assert.equal(preview.rows[0].eligible,true,'only the actual confirmed attendee is selected for a reminder');
    const reminder=await app.confirmationService.dispatchReminder({actor:users[0],expectedRevision:preview.revision,
      registrationIds:[registrationId],operationId:randomBytes(32).toString('base64url')});
    assert.equal(reminder.results.length,1);assert.equal(reminder.results[0].status,'provider_accepted');
    assert.equal(runtime.messages.length,3,'application receipt, formal confirmation and reminder each reach only the mock provider once');

    const syntheticWallet=createAppleWalletService({env:walletFixture.env,clock,tokenSecret:SECRET,eventFactsReadiness,
      trustedRootFingerprints:[walletFixture.rootHash],
      authorize:input=>app.confirmationService.authorize(input),
      authorizedRegistration:id=>app.confirmationService.authorizedRegistration(id)});
    const journalFor=prefix=>createObjectJournal({objects,prefix});
    const confirmationService=createRegistrationConfirmationService({registrationService:app.registrationService,
      journalFor,tokenSecret:SECRET,event:eventConfig,clock,eventFactsReadiness,
      walletReadiness:()=>syntheticWallet.readiness()});
    // This adapter exposes only capability reads; any attempted staff auth fails.
    const confirmationHandle=createRegistrationConfirmationApi({service:{confirmation:input=>confirmationService.confirmation(input)},
      auth:{authenticate(){assert.fail('public confirmation reads must not authenticate a staff session');}}});
    const walletHandle=createAppleWalletApi({service:syntheticWallet});
    let cleaned=false;
    async function cleanup(){if(cleaned)return;cleaned=true;await walletFixture.cleanup();}
    async function conflictPublishedFacts(){
      const current=(await app.store.read()).draft,next=structuredClone(current.content);
      next.event.date='2026-12-06';
      const changed=await app.store.save(current.revision,next,users[0].id);
      const published=await app.store.publish(changed.revision,users[0].id);
      const facts=await eventFactsReadiness();
      assert.equal(facts.ready,false);assert.equal(facts.reason,'EVENT_FACTS_MISMATCH');
      assert.equal(runtime.messages.length,3,'publishing conflicting facts never sends another notice');
      return published;
    }
    return {runtime,walletFixture,initialFacts,publicFacts,initialPublished,receiptToken,registrationId,
      syntheticWallet,confirmationService,confirmationHandle,walletHandle,eventFactsReadiness,conflictPublishedFacts,cleanup};
  } catch(error) {await walletFixture.cleanup();throw error;}
}
