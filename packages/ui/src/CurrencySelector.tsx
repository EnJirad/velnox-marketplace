import { CURRENCIES, type Currency } from "@velnox/types";
import { getStoredCurrency, setStoredCurrency } from "@velnox/utils";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./Select";

export function CurrencySelector() {
  const [currency, setCurrency] = useState<Currency>(getStoredCurrency);

  const handleChange = (value: string) => {
    const c = value as Currency;
    setCurrency(c);
    setStoredCurrency(c);
  };

  return (
    <Select value={currency} onValueChange={handleChange}>
      <SelectTrigger className="w-[100px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(CURRENCIES) as Currency[]).map((code) => (
          <SelectItem key={code} value={code}>
            <span className="flex items-center gap-1.5">
              <span>{CURRENCIES[code].symbol}</span>
              <span>{code}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
