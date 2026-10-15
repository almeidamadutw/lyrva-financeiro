import { normalizePostDateRows, sourceRowId, sourcePostingDay } from './source-response.mjs';

/** Validate the complete response before staging any financial write. */
export function validateSourceDay(payload, day) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object'
    && (payload.has_more === true || payload.hasMore === true || payload.next_cursor || payload.nextCursor)) {
    throw new Error('A fonte retornou uma página incompleta.');
  }
  return normalizePostDateRows(payload, day).map(row => {
    if (typeof row.id === 'number' && !Number.isSafeInteger(row.id)) throw new Error('ID numérico fora da precisão segura.');
    const id=sourceRowId(row);
    const raw=String(row.Amount ?? '').trim().replace(',', '.');
    if (!/^-?\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(Number(raw)) || Math.abs(Number(raw))>=1e12) {
      throw new Error(`Valor inválido no registro ${id}.`);
    }
    const boleto=String(row.PaymentForm).toLocaleLowerCase('pt-BR').includes('boleto');
    if (boleto && (Number(raw)<0 || !String(row.PatientId ?? '').trim() || !sourcePostingDay(row.DueDate))) {
      throw new Error(`Recebível incompleto no registro ${id}.`);
    }
    // Clinicorp omits blank flags on unpaid rows; only X represents a true flag.
    for (const field of ['PaymentReceived','PaymentConfirmed','Canceled','CancelInstallment']) {
      if (row[field]!=null && !['','X'].includes(String(row[field]).trim().toUpperCase())) {
        throw new Error(`Situação do pagamento inválida no registro ${id}.`);
      }
    }
    return {...row,id};
  });
}

/** A claimed payload resumes from its committed cursor without re-fetching it. */
export async function processJob(job, {rpc,fetchDay,remainingMs}) {
  const params={p_job_id:job.id,p_lease_token:job.lease_token};
  let phase=job.phase;
  if (phase==='fetch') {
    if (remainingMs()<23_000) {
      await rpc('release_clinicorp_sync_job',{...params,p_error:null});
      return {deferred:true,phase};
    }
    const rows=validateSourceDay(await fetchDay(job),job.posting_day);
    await rpc('stage_clinicorp_sync_job',{...params,p_rows:rows});
    phase='apply';
  }
  let processed=0,changed=0;
  while (phase==='apply' && remainingMs()>4_000) {
    const result=await rpc('apply_clinicorp_sync_batch',{...params,p_limit:25});
    if (!result || !['apply','verify'].includes(result.phase) || !Number.isInteger(result.rows) || result.rows<0
      || (result.phase==='apply' && result.rows===0)) throw new Error('O banco não confirmou o avanço do lote.');
    phase=result.phase;processed+=result.rows;changed+=Number(result.changed??0);
  }
  if (phase==='verify' && remainingMs()>3_000) {
    const result=await rpc('finish_clinicorp_sync_job',params);
    return {complete:true,processed,changed,...result};
  }
  await rpc('release_clinicorp_sync_job',{...params,p_error:null});
  return {deferred:true,phase,processed,changed};
}
