import {createPersonalPlatformHandler} from '../../src/personal-candidate/runtime-http.ts';
import {PersonalService} from '../../src/personal-candidate/service.ts';
import type {ProjectPin} from '../../src/personal-file-index/contract.ts';
import {MemoryPort} from './platform.ts';

const ownerId = 'file-index-fixture-owner';
const spaceId = 'file-index-fixture-space';
const ownerEmail = 'fixture@example.invalid';

export async function fileIndexFixture(baseURL = 'http://127.0.0.1:3111') {
  const config = {ownerId, spaceId, ownerEmail, baseURL, databaseName: 'fixture', approval: 'personal-manual-v1',
    allowedTypes: ['todo', 'project'], transport: 'ssh-loopback'} as const;
  const repository = new MemoryPort();
  repository.readCurrentSnapshot = async owner => [...repository.rows.values()].filter(row => row.ownerId === owner);
  const fields = {title: '同名合成项目', text: '', occurredOn: null, personal: {
    type: 'project', stage: 'active', purpose: null, nextStep: '', domain: null, topics: [],
  }};
  async function project(space: string, key: string): Promise<ProjectPin> {
    const service = new PersonalService(repository, {...config, spaceId: space});
    const {entry} = await service.mutate(ownerId, 'project', null, {spaceId: space, confirmed: true, fields}, key);
    return {id: entry.id, sourceId: entry.source.id, revision: entry.revision};
  }
  const exact = await project(spaceId, 'fixture-index-exact');
  const other = await project(spaceId, 'fixture-index-other');
  const foreign = await project('other-space', 'fixture-index-foreign');
  await new PersonalService(repository, config).mutate(ownerId, 'project', other.id, {
    spaceId, confirmed: true, expectedRevision: other.revision, fields: {...fields, text: 'New revision of the second project'},
  }, 'fixture-index-other-advanced');
  const entries = [
    {title: '合成索引甲', project: exact, location: {state: 'unverified', label: null}},
    {title: '合成索引乙', project: other, location: {state: 'unverified', label: null}},
    {title: '合成异空间', project: foreign, location: {state: 'unverified', label: null}},
    {title: '合成示例', project: exact, location: {state: 'example', label: 'fixture://example.invalid'}},
    {title: '合成错误来源', project: {...exact, sourceId: other.sourceId}, location: {state: 'verified', label: '合成位置', verifiedAt: '2031-03-10T00:00:00Z'}},
  ].map((row, index) => ({...row, id: nextId(index + 1), sourceId: nextId(index + 101), revision: 1}));
  const manifest = {version: 1, ownerId, spaceId, entries};
  let principal: {userId: string; email: string} | null = {userId: ownerId, email: ownerEmail};
  let writableChecks = 0;
  const handler = (manifestInput?: string, storageVerified = true) => createPersonalPlatformHandler({
    repository, config, fileIndexManifest: manifestInput, storageVerified,
    sessions: {read: async () => principal}, assertWritable: async () => { writableChecks++; throw Error('Read only'); },
  });
  return {config, repository, manifest, entries, exact, other, fields, handler, writableChecks: () => writableChecks,
    setPrincipal: (value: typeof principal) => { principal = value; }};
}

function nextId(n: number) { return '10000000-0000-4000-8000-' + String(n).padStart(12, '0'); }
