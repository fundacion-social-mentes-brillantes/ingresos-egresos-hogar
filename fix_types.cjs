const fs = require('fs');

const filePath = 'src/pages/AccountsPage.tsx';
let content = fs.readFileSync(filePath, 'utf-8');

content = content.replace(
  "import { WalletCards, Bot, User, ReceiptText, AlertTriangle, CheckCircle2, ArrowRightLeft, AlertCircle } from 'lucide-react';",
  "import { WalletCards, Bot, User, ReceiptText, AlertTriangle, CheckCircle2 } from 'lucide-react';"
);

content = content.replace(
  `      await transferBetweenAccounts(
        user.uid,
        transferFrom,
        fromAcc.name,
        transferTo,
        toAcc.name,
        amountNum,
        transferDescription
      );`,
  `      await transferBetweenAccounts(user.uid, {
        fromAccountId: transferFrom,
        toAccountId: transferTo,
        amount: amountNum,
        description: transferDescription
      });`
);

content = content.replace(
  `<Select
                      label="Cuenta origen (Retiro)"
                      value={transferFrom}
                      onChange={(e) => setTransferFrom(e.target.value)}
                      required
                    >
                      <option value="">Seleccionar cuenta</option>
                      {accounts.filter(a => a.active).map(a => (
                        <option key={\`from-\${a.id}\`} value={a.id}>{a.name} ({formatCOP(a.currentBalance)})</option>
                      ))}
                    </Select>`,
  `<Select
                      label="Cuenta origen (Retiro)"
                      value={transferFrom}
                      onChange={(e) => setTransferFrom(e.target.value)}
                      required
                      options={[
                        { value: '', label: 'Seleccionar cuenta' },
                        ...accounts.filter(a => a.active).map(a => ({
                          value: a.id,
                          label: \`\${a.name} (\${formatCOP(a.currentBalance)})\`
                        }))
                      ]}
                    />`
);

content = content.replace(
  `<Select
                      label="Cuenta destino (Ingreso)"
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value)}
                      required
                    >
                      <option value="">Seleccionar cuenta</option>
                      {accounts.filter(a => a.active).map(a => (
                        <option key={\`to-\${a.id}\`} value={a.id}>{a.name} ({formatCOP(a.currentBalance)})</option>
                      ))}
                    </Select>`,
  `<Select
                      label="Cuenta destino (Ingreso)"
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value)}
                      required
                      options={[
                        { value: '', label: 'Seleccionar cuenta' },
                        ...accounts.filter(a => a.active).map(a => ({
                          value: a.id,
                          label: \`\${a.name} (\${formatCOP(a.currentBalance)})\`
                        }))
                      ]}
                    />`
);

content = content.replace(
  `variant="secondary"`,
  `variant="ghost"`
);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Done fixing types!');
