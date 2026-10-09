"use client"

import * as React from "react"
import {
    ColumnDef,
    SortingState,
    flexRender,
    getCoreRowModel,
    useReactTable,
} from "@tanstack/react-table"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { HoldingsResult } from "@/lib/holdings-query"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Search, Download, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[]
    result: HoldingsResult
}

/**
 * Server-driven table: filtering, sorting and paging all happen in
 * lib/holdings-query.ts and are expressed as URL params, so the client only
 * ever holds one page of rows and every view is a shareable link.
 */
export function DataTable<TData, TValue>({
    columns,
    result,
}: DataTableProps<TData, TValue>) {
    const router = useRouter()
    const pathname = usePathname()
    const sp = useSearchParams()
    const { query, rows: data, total, funds: uniqueFunds } = result
    const [searchQuery, setSearchQuery] = React.useState(query.q)
    const pageCount = Math.max(1, Math.ceil(total / query.size))

    const navigate = React.useCallback((patch: Record<string, string | number | undefined>, resetPage = true) => {
        const next = new URLSearchParams(sp.toString())
        for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === "" || v === "ALL") next.delete(k)
            else next.set(k, String(v))
        }
        if (resetPage) next.delete("page")
        const qs = next.toString()
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }, [sp, router, pathname])

    // Debounce typing so each keystroke is not a server round-trip.
    React.useEffect(() => {
        if (searchQuery === query.q) return
        const t = setTimeout(() => navigate({ q: searchQuery.trim() || undefined }), 300)
        return () => clearTimeout(t)
    }, [searchQuery, query.q, navigate])

    const sorting: SortingState = query.sort ? [{ id: query.sort, desc: query.dir === "desc" }] : []

    const table = useReactTable({
        data: data as TData[],
        columns,
        getCoreRowModel: getCoreRowModel(),
        manualPagination: true,
        manualSorting: true,
        manualFiltering: true,
        pageCount,
        state: { sorting, pagination: { pageIndex: query.page - 1, pageSize: query.size } },
        onSortingChange: (updater) => {
            const next = typeof updater === "function" ? updater(sorting) : updater
            const first = next[0]
            navigate(first ? { sort: first.id, dir: first.desc ? "desc" : "asc" } : { sort: undefined, dir: undefined })
        },
    })

    const exportHref = React.useMemo(() => {
        const next = new URLSearchParams(sp.toString())
        next.delete("page")
        next.delete("size")
        const qs = next.toString()
        return qs ? `/holdings/export?${qs}` : "/holdings/export"
    }, [sp])

    const goToPage = (n: number) => navigate({ page: Math.min(Math.max(n, 1), pageCount) }, false)

    return (
        <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-4">
                <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                        <Input
                            placeholder="Search ticker or name..."
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            className="max-w-sm pl-9 bg-surface-alt border-surface-elevated text-slate-200 w-full sm:w-[250px]"
                        />
                    </div>

                    <Select
                        value={query.fund || "ALL"}
                        onValueChange={(val) => navigate({ fund: val })}
                    >
                        <SelectTrigger className="w-full sm:w-[180px] bg-surface-alt border-surface-elevated text-slate-200">
                            <SelectValue placeholder="All Funds" />
                        </SelectTrigger>
                        <SelectContent className="bg-surface-alt border-surface-elevated text-slate-200">
                            <SelectItem value="ALL">All Funds</SelectItem>
                            {uniqueFunds.map(f => (
                                <SelectItem key={f} value={f}>{f}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select
                        value={query.type}
                        onValueChange={(val) => navigate({ type: val })}
                    >
                        <SelectTrigger className="w-full sm:w-[180px] bg-surface-alt border-surface-elevated text-slate-200">
                            <SelectValue placeholder="Asset Type" />
                        </SelectTrigger>
                        <SelectContent className="bg-surface-alt border-surface-elevated text-slate-200">
                            <SelectItem value="ALL">All Assets</SelectItem>
                            <SelectItem value="STOCK">Stock Only</SelectItem>
                            <SelectItem value="Call">Calls</SelectItem>
                            <SelectItem value="Put">Puts</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <Button asChild variant={"outline"} className="bg-surface-alt border-surface-elevated text-slate-300 hover:bg-surface-elevated hover:text-white">
                    <a href={exportHref} download><Download className="mr-2 h-4 w-4" /> Export CSV</a>
                </Button>
            </div>
            <div className="rounded-md border border-rule overflow-x-auto">
                <Table>
                    <TableHeader className="bg-canvas border-b border-rule">
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id} className="border-rule hover:bg-transparent">
                                {headerGroup.headers.map((header) => {
                                    return (
                                        <TableHead key={header.id} className={`text-slate-400 font-semibold h-10 uppercase text-xs ${(header.column.columnDef.meta as any)?.cellClass ?? ""}`}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                        </TableHead>
                                    )
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody className="divide-y divide-rule">
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                    className="border-rule hover:bg-surface-hover transition-colors"
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} className={`py-2 px-4 ${(cell.column.columnDef.meta as any)?.cellClass ?? ""}`}>
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-24 text-center text-slate-500">
                                    No results found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 py-4">
                <div className="flex-1 text-sm text-slate-500 text-center sm:text-left">
                    Showing {total.toLocaleString()} results
                </div>
                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 lg:gap-x-8">
                    <div className="flex items-center space-x-2">
                        <p className="text-sm font-medium text-slate-400">Rows per page</p>
                        <Select
                            value={`${query.size}`}
                            onValueChange={(value) => navigate({ size: Number(value) === 50 ? undefined : Number(value) })}
                        >
                            <SelectTrigger className="h-8 w-[70px] bg-surface-alt border-surface-elevated text-slate-200">
                                <SelectValue placeholder={query.size} />
                            </SelectTrigger>
                            <SelectContent side="top" className="bg-surface-alt border-surface-elevated text-slate-200">
                                {[10, 20, 30, 40, 50, 100].map((pageSize) => (
                                    <SelectItem key={pageSize} value={`${pageSize}`}>
                                        {pageSize}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex w-[100px] items-center justify-center text-sm font-medium text-slate-400">
                        Page {query.page} of{" "}
                        {pageCount}
                    </div>
                    <div className="flex items-center space-x-2">
                        <Button
                            variant="outline"
                            className="h-8 w-8 p-0 bg-surface-alt border-surface-elevated text-slate-300 pointer-events-auto"
                            onClick={() => goToPage(1)}
                            disabled={query.page <= 1}
                        >
                            <span className="sr-only">Go to first page</span>
                            <ChevronsLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            className="h-8 w-8 p-0 bg-surface-alt border-surface-elevated text-slate-300 pointer-events-auto"
                            onClick={() => goToPage(query.page - 1)}
                            disabled={query.page <= 1}
                        >
                            <span className="sr-only">Go to previous page</span>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            className="h-8 w-8 p-0 bg-surface-alt border-surface-elevated text-slate-300 pointer-events-auto"
                            onClick={() => goToPage(query.page + 1)}
                            disabled={query.page >= pageCount}
                        >
                            <span className="sr-only">Go to next page</span>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            className="h-8 w-8 p-0 bg-surface-alt border-surface-elevated text-slate-300 pointer-events-auto"
                            onClick={() => goToPage(pageCount)}
                            disabled={query.page >= pageCount}
                        >
                            <span className="sr-only">Go to last page</span>
                            <ChevronsRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
