"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { catchUpLabel } from "@/lib/catch-up"

const catchUpTitle = (since: string) => `${catchUpLabel(since)}: the previous file was carried forward, so this is not a one-day change`

type SortableHeaderProps = {
    column: any
    label: string
    align?: "left" | "right" | "center"
}

function SortableHeader({ column, label, align = "left" }: SortableHeaderProps) {
    const sorted = column.getIsSorted()
    const icon = sorted === "asc"
        ? <ArrowUp className="ml-1 h-3 w-3 text-buy" />
        : sorted === "desc"
            ? <ArrowDown className="ml-1 h-3 w-3 text-buy" />
            : <ArrowUpDown className="ml-1 h-3 w-3 opacity-30 group-hover:opacity-70 transition-opacity" />

    const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start"

    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={() => column.toggleSorting(sorted === "asc")}
            className={`group flex items-center ${justify} w-full h-7 px-0 text-slate-400 hover:text-white hover:bg-transparent font-semibold uppercase text-xs -ml-0`}
        >
            {label}
            {icon}
        </Button>
    )
}

export const columns: ColumnDef<any>[] = [
    {
        accessorKey: "ETF Ticker",
        header: ({ column }) => <SortableHeader column={column} label="Fund" />,
        cell: ({ row }) => {
            const fund = row.getValue("ETF Ticker") as string
            const colors = ['bg-blue-500/20 text-blue-400 border-blue-500/30', 'bg-purple-500/20 text-purple-400 border-purple-500/30', 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', 'bg-amber-500/20 text-amber-400 border-amber-500/30', 'bg-rose-500/20 text-rose-400 border-rose-500/30'];
            let hash = 0;
            for (let i = 0; i < fund.length; i++) hash = fund.charCodeAt(i) + ((hash << 5) - hash);
            const color = colors[Math.abs(hash) % colors.length];

            return <Badge variant="outline" className={`font-mono border ${color}`}>{fund}</Badge>
        },
        filterFn: (row, id, value) => {
            return value.includes(row.getValue(id))
        },
    },
    {
        accessorKey: "Ticker",
        header: ({ column }) => <SortableHeader column={column} label="Ticker" />,
        cell: ({ row }) => <div className="font-mono font-medium text-slate-200">{row.getValue("Ticker")}</div>,
    },
    {
        accessorKey: "Name",
        meta: { cellClass: "hidden lg:table-cell" },
        header: ({ column }) => <SortableHeader column={column} label="Name" />,
        cell: ({ row }) => {
            return (
                <div className="max-w-[250px] truncate text-slate-400" title={row.getValue("Name")}>
                    {row.getValue("Name")}
                </div>
            )
        },
    },
    {
        accessorKey: "Option_Type",
        meta: { cellClass: "hidden sm:table-cell" },
        header: ({ column }) => <SortableHeader column={column} label="Type" align="center" />,
        cell: ({ row }) => {
            const type = row.getValue("Option_Type") as string | undefined
            if (!type) {
                return <div className="flex justify-center"><Badge variant="outline" className="text-slate-500 border-slate-700 bg-slate-800/50">STOCK</Badge></div>
            }
            return (
                <div className="flex justify-center">
                    {type.toLowerCase().startsWith('c') ? (
                        <Badge variant="outline" className="text-buy border-buy/30 bg-buy/10">CALL</Badge>
                    ) : (
                        <Badge variant="outline" className="text-sell border-sell/30 bg-sell/10">PUT</Badge>
                    )}
                </div>
            )
        },
    },
    {
        accessorKey: "Share Quantity",
        meta: { cellClass: "hidden md:table-cell" },
        header: ({ column }) => <SortableHeader column={column} label="Shares" align="right" />,
        cell: ({ row }) => {
            const shares = parseFloat(row.getValue("Share Quantity") as string)
            return (
                <div className={`text-right font-mono ${shares < 0 ? "text-sell" : "text-slate-300"}`}>
                    {shares.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
            )
        },
    },
    {
        accessorKey: "sharesDelta",
        meta: { cellClass: "hidden lg:table-cell" },
        header: ({ column }) => <SortableHeader column={column} label="Δ Shares" align="right" />,
        cell: ({ row }) => {
            const delta = row.getValue("sharesDelta") as number
            const since = (row.original as { catchUpSince?: string }).catchUpSince
            if (since !== undefined) return <div className="text-right font-mono text-slate-700" title={catchUpTitle(since)}>—</div>
            if (!delta || delta === 0) return <div className="text-right font-mono text-slate-700">—</div>
            const color = delta > 0 ? "text-buy" : "text-sell"
            return (
                <div className={`text-right font-mono ${color}`}>
                    {delta > 0 ? "+" : ""}{delta.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
            )
        },
        sortingFn: "basic",
    },
    {
        accessorKey: "Weight",
        meta: { cellClass: "hidden sm:table-cell" },
        header: ({ column }) => <SortableHeader column={column} label="Weight" align="right" />,
        cell: ({ row }) => {
            const weight = parseFloat(row.getValue("Weight") as string) || 0
            return <div className="text-right font-mono text-slate-300">{weight.toFixed(3)}%</div>
        },
        sortingFn: "basic",
    },
    {
        accessorKey: "weightDelta",
        header: ({ column }) => <SortableHeader column={column} label="Δ Weight" align="right" />,
        cell: ({ row }) => {
            const delta = row.getValue("weightDelta") as number
            const since = (row.original as { catchUpSince?: string }).catchUpSince
            if (since !== undefined) return <div className="text-right font-mono text-slate-700" title={catchUpTitle(since)}>—</div>
            if (!delta || delta === 0) return <div className="text-right font-mono text-slate-700">—</div>
            const color = delta > 0 ? "text-buy" : "text-sell"
            return (
                <div className={`text-right font-mono font-semibold ${color}`}>
                    {delta > 0 ? "+" : ""}{delta.toFixed(3)}%
                </div>
            )
        },
        sortingFn: "basic",
    },
    {
        accessorKey: "Market Value",
        meta: { cellClass: "hidden md:table-cell" },
        header: ({ column }) => <SortableHeader column={column} label="Mkt Val" align="right" />,
        cell: ({ row }) => {
            const mv = parseFloat(row.getValue("Market Value") as string) || 0
            return <div className="text-right font-mono text-slate-300">${mv.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        },
        sortingFn: "basic",
    },
    {
        accessorKey: "Option_Strike",
        meta: { cellClass: "hidden xl:table-cell" },
        header: ({ column }) => <SortableHeader column={column} label="Strike" align="right" />,
        cell: ({ row }) => {
            const strike = row.getValue("Option_Strike") as number | undefined
            return <div className="text-right font-mono text-slate-400">{strike ? strike.toFixed(2) : "-"}</div>
        },
    },
    {
        accessorKey: "Option_Expiry",
        meta: { cellClass: "hidden xl:table-cell" },
        header: ({ column }) => <SortableHeader column={column} label="Expiry" align="center" />,
        cell: ({ row }) => {
            const expiry = row.getValue("Option_Expiry") as string | undefined
            return <div className="text-center font-mono text-slate-400">{expiry || "-"}</div>
        },
    },
    {
        accessorKey: "DTE",
        meta: { cellClass: "hidden lg:table-cell" },
        header: ({ column }) => <SortableHeader column={column} label="DTE" align="right" />,
        cell: ({ row }) => {
            const dte = row.getValue("DTE") as number | undefined
            if (dte === undefined || dte === null) return <div className="text-right font-mono text-slate-500">-</div>

            let colorClass = "text-slate-400"
            if (dte < 7) colorClass = "text-sell font-bold"
            else if (dte < 14) colorClass = "text-amber-400 font-bold"

            return <div className={`text-right font-mono ${colorClass}`}>{dte}</div>
        },
    },
]
