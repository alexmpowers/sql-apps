CREATE TABLE dbo.DemoSessions (
    token_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_DemoSessions PRIMARY KEY,
    expires_at datetime2(3) NOT NULL,
    window_start datetime2(3) NOT NULL,
    mutation_count smallint NOT NULL CONSTRAINT DF_DemoSessions_Mutations DEFAULT 0,
    CONSTRAINT CK_DemoSessions_Mutations CHECK (mutation_count BETWEEN 0 AND 30)
);
GO
CREATE INDEX IX_DemoSessions_Expiry ON dbo.DemoSessions(expires_at);
GO
CREATE TABLE dbo.DemoLimits (
    id tinyint NOT NULL CONSTRAINT PK_DemoLimits PRIMARY KEY,
    global_window_start datetime2(3) NOT NULL,
    global_mutation_count smallint NOT NULL,
    CONSTRAINT CK_DemoLimits_Singleton CHECK (id = 1),
    CONSTRAINT CK_DemoLimits_Mutations CHECK (global_mutation_count BETWEEN 0 AND 300)
);
GO
CREATE TABLE dbo.Todos (
    id uniqueidentifier NOT NULL CONSTRAINT PK_Todos PRIMARY KEY,
    owner_session_hash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
    title nvarchar(200) NOT NULL,
    completed bit NOT NULL CONSTRAINT DF_Todos_Completed DEFAULT 0,
    created_at datetime2(3) NOT NULL CONSTRAINT DF_Todos_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_Todos_DemoSession FOREIGN KEY (owner_session_hash)
        REFERENCES dbo.DemoSessions(token_hash) ON DELETE CASCADE,
    CONSTRAINT CK_Todos_Title CHECK (LEN(title) > 0)
);
GO
CREATE INDEX IX_Todos_DemoOwner ON dbo.Todos(owner_session_hash, created_at, id);
