
declare const enum FMDBCheckpointMode {

	Passive = 0,

	Full = 1,

	Restart = 2,

	Truncate = 3
}

declare var FMDBVersionNumber: number;

declare var FMDBVersionNumberVar: number;

declare var FMDBVersionString: interop.Reference<number>;

declare var FMDBVersionStringVar: interop.Reference<number>;

declare class FMDatabase extends NSObject {

	static FMDBUserVersion(): string;

	static FMDBVersion(): number;

	static alloc(): FMDatabase; // inherited from NSObject

	static databaseWithPath(inPath: string): FMDatabase;

	static databaseWithURL(url: NSURL): FMDatabase;

	static isSQLiteThreadSafe(): boolean;

	static new(): FMDatabase; // inherited from NSObject

	static sqliteLibVersion(): string;

	static storeableDateFormat(format: string): NSDateFormatter;

	applicationID: number;

	cachedStatements: NSMutableDictionary<any, any>;

	readonly changes: number;

	checkedOut: boolean;

	crashOnErrors: boolean;

	readonly databasePath: string;

	readonly databaseURL: NSURL;

	readonly goodConnection: boolean;

	readonly hasOpenResultSets: boolean;

	readonly isInTransaction: boolean;

	isOpen: boolean;

	readonly lastInsertRowId: number;

	logsErrors: boolean;

	maxBusyRetryTimeInterval: number;

	shouldCacheStatements: boolean;

	readonly sqliteHandle: interop.Pointer | interop.Reference<any>;

	traceExecution: boolean;

	userVersion: number;

	constructor(o: { path: string; });

	constructor(o: { URL: NSURL; });

	beginDeferredTransaction(): boolean;

	beginExclusiveTransaction(): boolean;

	beginImmediateTransaction(): boolean;

	beginTransaction(): boolean;

	checkpointError(checkpointMode: FMDBCheckpointMode): boolean;

	checkpointNameError(checkpointMode: FMDBCheckpointMode, name: string): boolean;

	checkpointNameLogFrameCountCheckpointCountError(checkpointMode: FMDBCheckpointMode, name: string, logFrameCount: interop.Pointer | interop.Reference<number>, checkpointCount: interop.Pointer | interop.Reference<number>): boolean;

	clearCachedStatements(): void;

	close(): boolean;

	closeOpenResultSets(): void;

	columnExistsColumnName(tableName: string, columnName: string): boolean;

	columnExistsInTableWithName(columnName: string, tableName: string): boolean;

	commit(): boolean;

	dateFromString(s: string): Date;

	executeQueryValuesError(sql: string, values: NSArray<any> | any[]): FMResultSet;

	executeQueryWithArgumentsInArray(sql: string, _arguments: NSArray<any> | any[]): FMResultSet;

	executeQueryWithParameterDictionary(sql: string, _arguments: NSDictionary<any, any>): FMResultSet;

	executeStatements(sql: string): boolean;

	executeStatementsWithResultBlock(sql: string, block: (p1: NSDictionary<any, any>) => number): boolean;

	executeUpdateValuesError(sql: string, values: NSArray<any> | any[]): boolean;

	executeUpdateWithArgumentsInArray(sql: string, _arguments: NSArray<any> | any[]): boolean;

	executeUpdateWithParameterDictionary(sql: string, _arguments: NSDictionary<any, any>): boolean;

	getSchema(): FMResultSet;

	getTableSchema(tableName: string): FMResultSet;

	hadError(): boolean;

	hasDateFormatter(): boolean;

	inSavePoint(block: (p1: interop.Pointer | interop.Reference<boolean>) => void): NSError;

	inTransaction(): boolean;

	initWithPath(path: string): this;

	initWithURL(url: NSURL): this;

	interrupt(): boolean;

	lastError(): NSError;

	lastErrorCode(): number;

	lastErrorMessage(): string;

	lastExtendedErrorCode(): number;

	makeFunctionNamedArgumentsBlock(name: string, _arguments: number, block: (p1: interop.Pointer | interop.Reference<any>, p2: number, p3: interop.Pointer | interop.Reference<interop.Pointer | interop.Reference<any>>) => void): void;

	makeFunctionNamedMaximumArgumentsWithBlock(name: string, count: number, block: (p1: interop.Pointer | interop.Reference<any>, p2: number, p3: interop.Pointer | interop.Reference<interop.Pointer | interop.Reference<any>>) => void): void;

	open(): boolean;

	openWithFlags(flags: number): boolean;

	openWithFlagsVfs(flags: number, vfsName: string): boolean;

	rekey(key: string): boolean;

	rekeyWithData(keyData: NSData): boolean;

	releaseSavePointWithNameError(name: string): boolean;

	resultDataContext(data: NSData, context: interop.Pointer | interop.Reference<any>): void;

	resultDoubleContext(value: number, context: interop.Pointer | interop.Reference<any>): void;

	resultErrorCodeContext(errorCode: number, context: interop.Pointer | interop.Reference<any>): void;

	resultErrorContext(error: string, context: interop.Pointer | interop.Reference<any>): void;

	resultErrorNoMemoryInContext(context: interop.Pointer | interop.Reference<any>): void;

	resultErrorTooBigInContext(context: interop.Pointer | interop.Reference<any>): void;

	resultIntContext(value: number, context: interop.Pointer | interop.Reference<any>): void;

	resultLongContext(value: number, context: interop.Pointer | interop.Reference<any>): void;

	resultNullInContext(context: interop.Pointer | interop.Reference<any>): void;

	resultStringContext(value: string, context: interop.Pointer | interop.Reference<any>): void;

	rollback(): boolean;

	rollbackToSavePointWithNameError(name: string): boolean;

	setDateFormat(format: NSDateFormatter): void;

	setKey(key: string): boolean;

	setKeyWithData(keyData: NSData): boolean;

	startSavePointWithNameError(name: string): boolean;

	stringFromDate(date: Date): string;

	tableExists(tableName: string): boolean;

	validateSQLError(sql: string): boolean;

	valueData(value: interop.Pointer | interop.Reference<any>): NSData;

	valueDouble(value: interop.Pointer | interop.Reference<any>): number;

	valueInt(value: interop.Pointer | interop.Reference<any>): number;

	valueLong(value: interop.Pointer | interop.Reference<any>): number;

	valueString(value: interop.Pointer | interop.Reference<any>): string;

	valueType(argv: interop.Pointer | interop.Reference<any>): SqliteValueType;
}

declare class FMDatabasePool extends NSObject {

	static alloc(): FMDatabasePool; // inherited from NSObject

	static databaseClass(): typeof NSObject;

	static databasePoolWithPath(aPath: string): FMDatabasePool;

	static databasePoolWithPathFlags(aPath: string, openFlags: number): FMDatabasePool;

	static databasePoolWithURL(url: NSURL): FMDatabasePool;

	static databasePoolWithURLFlags(url: NSURL, openFlags: number): FMDatabasePool;

	static new(): FMDatabasePool; // inherited from NSObject

	readonly countOfCheckedInDatabases: number;

	readonly countOfCheckedOutDatabases: number;

	readonly countOfOpenDatabases: number;

	delegate: any;

	maximumNumberOfDatabasesToCreate: number;

	readonly openFlags: number;

	path: string;

	vfsName: string;

	constructor(o: { path: string; });

	constructor(o: { path: string; flags: number; });

	constructor(o: { path: string; flags: number; vfs: string; });

	constructor(o: { URL: NSURL; });

	constructor(o: { URL: NSURL; flags: number; });

	constructor(o: { URL: NSURL; flags: number; vfs: string; });

	inDatabase(block: (p1: FMDatabase) => void): void;

	inDeferredTransaction(block: (p1: FMDatabase, p2: interop.Pointer | interop.Reference<boolean>) => void): void;

	inExclusiveTransaction(block: (p1: FMDatabase, p2: interop.Pointer | interop.Reference<boolean>) => void): void;

	inImmediateTransaction(block: (p1: FMDatabase, p2: interop.Pointer | interop.Reference<boolean>) => void): void;

	inSavePoint(block: (p1: FMDatabase, p2: interop.Pointer | interop.Reference<boolean>) => void): NSError;

	inTransaction(block: (p1: FMDatabase, p2: interop.Pointer | interop.Reference<boolean>) => void): void;

	initWithPath(aPath: string): this;

	initWithPathFlags(aPath: string, openFlags: number): this;

	initWithPathFlagsVfs(aPath: string, openFlags: number, vfsName: string): this;

	initWithURL(url: NSURL): this;

	initWithURLFlags(url: NSURL, openFlags: number): this;

	initWithURLFlagsVfs(url: NSURL, openFlags: number, vfsName: string): this;

	releaseAllDatabases(): void;
}

declare class FMDatabaseQueue extends NSObject {

	static alloc(): FMDatabaseQueue; // inherited from NSObject

	static databaseClass(): typeof NSObject;

	static databaseQueueWithPath(aPath: string): FMDatabaseQueue;

	static databaseQueueWithPathFlags(aPath: string, openFlags: number): FMDatabaseQueue;

	static databaseQueueWithURL(url: NSURL): FMDatabaseQueue;

	static databaseQueueWithURLFlags(url: NSURL, openFlags: number): FMDatabaseQueue;

	static new(): FMDatabaseQueue; // inherited from NSObject

	readonly openFlags: number;

	path: string;

	vfsName: string;

	constructor(o: { path: string; });

	constructor(o: { path: string; flags: number; });

	constructor(o: { path: string; flags: number; vfs: string; });

	constructor(o: { URL: NSURL; });

	constructor(o: { URL: NSURL; flags: number; });

	constructor(o: { URL: NSURL; flags: number; vfs: string; });

	checkpointError(checkpointMode: FMDBCheckpointMode): boolean;

	checkpointNameError(checkpointMode: FMDBCheckpointMode, name: string): boolean;

	checkpointNameLogFrameCountCheckpointCountError(checkpointMode: FMDBCheckpointMode, name: string, logFrameCount: interop.Pointer | interop.Reference<number>, checkpointCount: interop.Pointer | interop.Reference<number>): boolean;

	close(): void;

	inDatabase(block: (p1: FMDatabase) => void): void;

	inDeferredTransaction(block: (p1: FMDatabase, p2: interop.Pointer | interop.Reference<boolean>) => void): void;

	inExclusiveTransaction(block: (p1: FMDatabase, p2: interop.Pointer | interop.Reference<boolean>) => void): void;

	inImmediateTransaction(block: (p1: FMDatabase, p2: interop.Pointer | interop.Reference<boolean>) => void): void;

	inSavePoint(block: (p1: FMDatabase, p2: interop.Pointer | interop.Reference<boolean>) => void): NSError;

	inTransaction(block: (p1: FMDatabase, p2: interop.Pointer | interop.Reference<boolean>) => void): void;

	initWithPath(aPath: string): this;

	initWithPathFlags(aPath: string, openFlags: number): this;

	initWithPathFlagsVfs(aPath: string, openFlags: number, vfsName: string): this;

	initWithURL(url: NSURL): this;

	initWithURLFlags(url: NSURL, openFlags: number): this;

	initWithURLFlagsVfs(url: NSURL, openFlags: number, vfsName: string): this;

	interrupt(): void;
}

declare class FMResultSet extends NSObject {

	static alloc(): FMResultSet; // inherited from NSObject

	static new(): FMResultSet; // inherited from NSObject

	static resultSetWithStatementUsingParentDatabase(statement: FMStatement, aDB: FMDatabase): FMResultSet;

	readonly columnCount: number;

	readonly columnNameToIndexMap: NSMutableDictionary<any, any>;

	parentDB: FMDatabase;

	query: string;

	readonly resultDictionary: NSDictionary<any, any>;

	statement: FMStatement;
	[index: number]: any;

	UTF8StringForColumn(columnName: string): string;

	UTF8StringForColumnIndex(columnIdx: number): string;

	UTF8StringForColumnName(columnName: string): string;

	boolForColumn(columnName: string): boolean;

	boolForColumnIndex(columnIdx: number): boolean;

	close(): void;

	columnIndexForName(columnName: string): number;

	columnIndexIsNull(columnIdx: number): boolean;

	columnIsNull(columnName: string): boolean;

	columnNameForIndex(columnIdx: number): string;

	dataForColumn(columnName: string): NSData;

	dataForColumnIndex(columnIdx: number): NSData;

	dataNoCopyForColumn(columnName: string): NSData;

	dataNoCopyForColumnIndex(columnIdx: number): NSData;

	dateForColumn(columnName: string): Date;

	dateForColumnIndex(columnIdx: number): Date;

	doubleForColumn(columnName: string): number;

	doubleForColumnIndex(columnIdx: number): number;

	hasAnotherRow(): boolean;

	intForColumn(columnName: string): number;

	intForColumnIndex(columnIdx: number): number;

	kvcMagic(object: any): void;

	longForColumn(columnName: string): number;

	longForColumnIndex(columnIdx: number): number;

	longLongIntForColumn(columnName: string): number;

	longLongIntForColumnIndex(columnIdx: number): number;

	next(): boolean;

	nextWithError(): boolean;

	objectAtIndexedSubscript(columnIdx: number): any;

	objectForColumn(columnName: string): any;

	objectForColumnIndex(columnIdx: number): any;

	objectForColumnName(columnName: string): any;

	objectForKeyedSubscript(columnName: string): any;

	resultDict(): NSDictionary<any, any>;

	stringForColumn(columnName: string): string;

	stringForColumnIndex(columnIdx: number): string;

	unsignedLongLongIntForColumn(columnName: string): number;

	unsignedLongLongIntForColumnIndex(columnIdx: number): number;
}

declare class FMStatement extends NSObject {

	static alloc(): FMStatement; // inherited from NSObject

	static new(): FMStatement; // inherited from NSObject

	inUse: boolean;

	query: string;

	statement: interop.Pointer | interop.Reference<any>;

	useCount: number;

	close(): void;

	reset(): void;
}

declare const enum SqliteValueType {

	Integer = 1,

	Float = 2,

	Text = 3,

	Blob = 4,

	Null = 5
}
