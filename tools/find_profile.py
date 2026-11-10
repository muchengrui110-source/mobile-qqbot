import glob, os
dirs = [p for p in glob.glob('/root/.dsh/profiles/*') if os.path.isdir(p)]
print(sorted(dirs)[0] if dirs else '/root/.dsh/profiles/web')
