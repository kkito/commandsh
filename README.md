# commands

The CLI for the open agent commands ecosystem.

用 [skills.sh](https://skills.sh) 的思路安装commands

commands也很好用，省token， 省上下文，执行更明确

## Install a Command

```bash
npx @kkito/commandsh add yourname/commands
npx @kkito/commandsh add https://github.com/yourname/commands
npx @kkito/commandsh add /localpath/projname
```

安装对应项目里的 `commands` 下的文件到agent工具
eg:

- commands/demo1.md
- commands/demogroup/demo2.md
- commands/demogroup/demo3.md

## License

MIT
