import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsername, canManage } from '../supabase/functions/_shared/access.ts';

test('login aceita o identificador completo sem transformar endereços desconhecidos', () => {
  assert.equal(normalizeUsername(' Suporte@lyvrafinanceiro '), 'suporte');
  assert.equal(normalizeUsername('ana.silva@lyvrafinanceiro'), 'ana.silva');
  for (const value of ['suporte@gmail.com', 'a', 'ana+silva', '<script>', 'a'.repeat(41), null]) assert.equal(normalizeUsername(value), '');
});
test('somente o dono do suporte pode gerenciar o próprio acesso', () => {
  const target = {user_id:'owner',role:'suporte'};
  assert.equal(canManage('suporte','owner',target,new Set([1]),[1]),true);
  for (const role of ['ceo','gestora','membro']) assert.equal(canManage(role,'leader',target,new Set([1,2]),[1]),false);
  assert.equal(canManage('suporte','other',target,new Set([1,2]),[1]),false);
});
test('gestora recupera somente membros cujas unidades ela administra', () => {
  assert.equal(canManage('gestora','leader',{user_id:'member',role:'membro'},new Set([1]),[1]),true);
  assert.equal(canManage('gestora','leader',{user_id:'member',role:'membro'},new Set([1]),[1,2]),false);
  assert.equal(canManage('gestora','leader',{user_id:'ceo',role:'ceo'},new Set([1,2]),[1]),false);
  assert.equal(canManage('membro','member',{user_id:'member',role:'membro'},new Set([1]),[1]),false);
});
