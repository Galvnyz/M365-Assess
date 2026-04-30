// Shared bits for finding-detail directions: a faux table-row header that
// hosts the expanded panel below, plus tiny status/severity chips. Each
// direction renders <FdHost finding={...}><Fd?Detail/></FdHost> for parity.

const FD_STATUS_COLORS = { Pass:'pass', Fail:'fail', Warn:'warn', Review:'review', Info:'info' };
const FD_SEV_LABEL = { critical:'Critical', high:'High', medium:'Medium', low:'Low', info:'Info', none:'None' };

function FdHost({ finding, children }) {
  const f = finding;
  return (
    <div className="fd-host">
      <div className="fd-host-row">
        <div>
          <span className={'status-badge ' + FD_STATUS_COLORS[f.status]}>
            <span className="dot"/>{f.status}
          </span>
        </div>
        <div>
          <div className="t">{f.setting}</div>
          <div className="sub">{f.section}</div>
        </div>
        <div className="finding-dom">{f.domain}</div>
        <div>
          <code style={{fontFamily:'var(--font-mono)', fontSize:11.5, color:'var(--text-soft)'}}>{f.checkId}</code>
        </div>
        <div>
          <span className={'sev-badge ' + f.severity}>
            <span className="bar"><i/><i/><i/><i/></span>
            <span>{FD_SEV_LABEL[f.severity]}</span>
          </span>
        </div>
        <div className="caret">›</div>
      </div>
      {children}
    </div>
  );
}

window.FdHost = FdHost;
window.FD_STATUS_COLORS = FD_STATUS_COLORS;
window.FD_SEV_LABEL = FD_SEV_LABEL;
window.FD_FW_NAMES = window.MOCK_FRAMEWORK_NAMES;
