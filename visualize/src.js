// The Python each step is anchored to, quoted from the memcommit library. The page does not show it; it names the step instead. Docstrings and unrelated branches are
// elided with `# ...` comments, and type annotations are dropped; every other line is the library's own. A trailing `#@name` marks a line the
// tracer can point at, and is not shown.

const BLOCKS = {
  put: `
#@p_def
#@p_with
#@p_txput
#@p_ret



#@t_new

#@t_commit



#@tp_memory


#@tp_op



#@tm_op


#@tr_op


#@tx_op


#@tv_op




#@m_id


#@m_content
#@m_hash
`,
  commit: `

#@c_records
#@c_lsn
#@c_now


#@c_for
#@c_current

#@c_samet

#@c_sett

#@c_ifput

#@c_noop

#@c_setstatus



#@c_append

#@c_empty

#@c_commit

#@c_engine
#@c_txn
#@c_applyfor
#@c_apply

#@c_return




#@a_new




#@a_ifmove
#@a_tier

#@a_status

#@a_lsn
`,
  invalidate: `

#@i_refs
#@i_targets
#@i_deps
#@i_if
#@i_with
#@i_for
#@i_mark
#@i_ret



#@d_found
#@d_frontier

#@d_for
#@d_if
#@d_add



#@dep_ret
`,
  rollback: `

#@r_if

#@r_target
#@r_reason
#@r_with
#@r_for
#@r_wanted
#@r_diff

#@r_restore

#@r_stale

#@r_retract
#@r_tier

#@r_move
#@r_ret


#@as_of




#@s_state
#@s_for
#@s_until

#@s_apply
#@s_ret
`,
  fold: `

#@f_init


#@f_for
#@f_break


#@f_put

#@f_move


#@f_status
#@f_kept
#@f_status_kept
#@f_move_kept
#@f_ret
`,
  compact: `

#@k_records
#@k_horizon

#@k_later
#@k_touched
#@k_at
#@k_now
#@k_purged





#@k_folded
#@k_digest
#@k_rewrite
#@k_replay
#@k_body






#@k_manifest
#@k_seal



#@ao_if

#@ao_ret


#@h_init
#@h_for


#@h_link
#@h_ret
`,
  maintain: `

#@mt_done

#@mt_compact


#@mt_promote

#@mt_dest
#@mt_evict




#@e_for

#@e_victims

#@e_over


#@e_gone

#@e_lru
#@e_add
#@e_move
#@e_ret



#@lru



#@cr_run


#@cc_body
#@cc_live
#@cc_with
#@cc_put








#@cc_for
#@cc_move
#@cc_ret
`,
  move: `

#@mv_moved

#@mv_with
#@mv_for
#@mv_move

`,
  open: `


#@ss_write
#@ss_replace




#@o_state
#@o_snapif

#@o_snapload
#@o_for
#@o_apply

`,
};

// compile(['put', 'commit']) -> { lines: [{text, id}], at: {id: lineNumber} }
export function compile(names) {
  const lines = [], at = {};
  names.forEach((name, bi) => {
    if (bi) lines.push({ text: '', id: null });
    BLOCKS[name].replace(/^\n/, '').replace(/\n$/, '').split('\n').forEach((raw) => {
      const m = raw.match(/\s*#@(\w+)\s*$/);
      const id = m ? m[1] : null;
      const text = m ? raw.slice(0, m.index) : raw;
      lines.push({ text, id });
      if (id) {
        if (at[id]) throw new Error('duplicate line id ' + id);
        at[id] = lines.length;
      }
    });
  });
  return { lines, at, names };
}

export const BLOCK_NAMES = Object.keys(BLOCKS);
