(function exposeMiraBoardContracts(root) {
  "use strict";

  const VERSION = 1;
  const READ_CONTRACTS = {
    bootstrap: "miraboard.read.bootstrap",
    "research-index": "miraboard.read.research-index",
    "market-session": "miraboard.read.market-session",
    "market-calendar": "miraboard.read.market-calendar",
    "market-pulse": "miraboard.read.market-pulse",
    "research-feed": "miraboard.read.research-feed",
    "provider-status": "miraboard.read.provider-status",
    "position-reviews": "miraboard.read.position-reviews",
    "source-file": "miraboard.read.source-file",
    quote: "miraboard.read.quote",
    quotes: "miraboard.read.quotes",
    "mira-levels": "miraboard.read.mira-levels",
    health: "miraboard.read.health",
    "ai-config": "miraboard.read.ai-config",
    "operations-catalog": "miraboard.read.operations-catalog",
  };
  const OPERATION_CONTRACT = "miraboard.operation.result";

  function assertReadContract(payload, name) {
    const contract = payload?.contract;
    if (contract?.name !== READ_CONTRACTS[name] || contract?.version !== VERSION || contract?.layer !== "read") {
      throw new Error(`API 数据契约不兼容：${name}`);
    }
    return payload;
  }

  function assertOperationContract(payload) {
    const contract = payload?.contract;
    if (contract?.name !== OPERATION_CONTRACT || contract?.version !== VERSION || contract?.layer !== "controlled-operation") {
      throw new Error("受控操作返回的数据契约不兼容");
    }
    return payload;
  }

  root.MiraBoardContracts = { VERSION, READ_CONTRACTS, assertReadContract, assertOperationContract };
  if (typeof module !== "undefined" && module.exports) module.exports = root.MiraBoardContracts;
})(typeof globalThis !== "undefined" ? globalThis : this);
