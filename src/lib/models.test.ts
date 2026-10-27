import { expect, test } from 'vitest';
import { groupModels, modelLink, modelNote } from './models';
import type { Layers } from './model/bundle';
import type { Model } from './types';

const m = (id: string, source: string | null = null, licence_mode: Model['licence_mode'] = 'commercial-ok'): Model =>
  ({ id, source, revision: null, licence: null, licence_mode });

test('a model links to its page when its source or id says where it is, and to nothing it would have to guess', () => {
  expect(modelLink(m('nvidia/parakeet-tdt-0.6b-v3 (mlx-community conversion)', 'hf://mlx-community/parakeet-tdt-0.6b-v3')))
    .toBe('https://huggingface.co/mlx-community/parakeet-tdt-0.6b-v3');
  expect(modelLink(m('LR-ASD (TalkSet finetune)', 'https://github.com/Junhua-Liao/LR-ASD'))).toBe('https://github.com/Junhua-Liao/LR-ASD');
  expect(modelLink(m('py-feat Detectorv2', 'py-feat==2.1.5 (weights from hf://py-feat)'))).toBe('https://huggingface.co/py-feat');
  expect(modelLink(m('facebook/dinov3-vitl16-pretrain-lvd1689m'))).toBe('https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m');
  expect(modelLink(m('claude-haiku-5-5 (object names, name families, crop check)'))).toMatch(/^https:\/\/docs\.anthropic\.com\//);
  expect(modelLink(m('rtmw'))).toBeNull();
  expect(modelLink(m('rules over hand keypoints and face landmarks'))).toBeNull();
});

test('a model is named by its id, with its parenthesis as a note', () => {
  expect(modelNote(m('facebook/sam3 (Sam3VideoModel, bfloat16)'))).toMatchObject({ name: 'facebook/sam3', detail: 'Sam3VideoModel, bfloat16' });
  expect(modelNote(m('PANNs Cnn14_DecisionLevelMax'))).toMatchObject({ name: 'PANNs Cnn14_DecisionLevelMax', detail: null });
});

test('a group lists the models of the layers it draws, each once', () => {
  const layer = (...models: Model[]) => ({ producer: { models } });
  const layers = { transcript: layer(m('a/asr')), speakers: layer(m('asd'), m('a/asr')), faces: layer(m('face')) } as unknown as Layers;
  expect(groupModels(layers, 'audio').map((x) => x.name)).toEqual(['a/asr', 'asd']);
  expect(groupModels(layers, 'people').map((x) => x.name)).toEqual(['face', 'asd', 'a/asr']);
  expect(groupModels(layers, 'annotations')).toEqual([]);
  expect(groupModels(layers, 'objects')).toEqual([]);   // a layer that was not run
});
